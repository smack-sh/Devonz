import { type ActionFunctionArgs } from '@remix-run/node';
import { createDataStream, generateId } from 'ai';
import { z } from 'zod';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/new-prompt';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { DesignScheme } from '~/types/design-scheme';
import { MCPService } from '~/lib/services/mcpService';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { withSecurity } from '~/lib/security';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import {
  getAgentToolSetWithoutExecute,
  shouldUseAgentMode,
  initializeAgentSession,
  incrementAgentIteration,
  getAgentIterationWarning,
  processAgentToolInvocations,
  processAgentToolCall,
  isAgentToolName,
} from '~/lib/services/agentChatIntegration';

export const action = withSecurity(chatAction, {
  allowedMethods: ['POST'],
  rateLimit: false,
});

const logger = createScopedLogger('api.chat');

// Zod schema for chat request validation
const messageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })
  .passthrough(); // Preserve 'parts' and other AI SDK fields for MCP tool invocations

const designSchemeSchema = z
  .object({
    palette: z.record(z.string()),
    features: z.array(z.string()),
    font: z.array(z.string()),
  })
  .optional();

const supabaseConnectionSchema = z
  .object({
    isConnected: z.boolean(),
    hasSelectedProject: z.boolean(),
    credentials: z
      .object({
        anonKey: z.string().optional(),
        supabaseUrl: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1, 'At least one message is required'),
  files: z.any().optional(),
  promptId: z.string().optional(),
  contextOptimization: z.boolean().default(false),
  enableThinking: z.boolean().default(false),
  chatMode: z.enum(['discuss', 'build']).default('build'),
  planMode: z.boolean().default(false),
  designScheme: designSchemeSchema,
  supabase: supabaseConnectionSchema,
  maxLLMSteps: z.number().int().positive().max(20).default(5),
  agentMode: z.boolean().optional(),
});

async function chatAction({ context, request }: ActionFunctionArgs) {
  // Parse and validate request body
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = chatRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    logger.warn('Chat request validation failed:', parsed.error.issues);

    return new Response(
      JSON.stringify({
        error: 'Invalid request',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const {
    messages,
    files,
    promptId,
    contextOptimization,
    enableThinking,
    supabase,
    chatMode,
    designScheme,
    planMode,
    maxLLMSteps,
    agentMode,
  } = parsed.data as {
    messages: Messages;
    files: FileMap | undefined;
    promptId?: string;
    contextOptimization: boolean;
    enableThinking: boolean;
    chatMode: 'discuss' | 'build';
    planMode: boolean;
    designScheme?: DesignScheme;
    supabase?: {
      isConnected: boolean;
      hasSelectedProject: boolean;
      credentials?: {
        anonKey?: string;
        supabaseUrl?: string;
      };
    };
    maxLLMSteps: number;
    agentMode?: boolean;
  };

  // Determine if agent mode should be active for this request
  const useAgentMode = shouldUseAgentMode({ agentMode });

  /*
   * Agent mode tools (MCP) require user approval in the UI, so the
   * stream can be idle for minutes while the user reviews a tool call.
   * Use a 5-minute timeout to prevent false stream-recovery kills.
   * Normal (non-agent) mode keeps the 45-second timeout.
   */
  const streamRecovery = new StreamRecoveryManager({
    timeout: useAgentMode ? 300_000 : 45_000,
    maxRetries: useAgentMode ? 0 : 2,
    onTimeout: () => {
      logger.warn('Stream timeout - attempting recovery');
    },
  });

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings: Record<string, IProviderSetting> = getProviderSettingsFromCookie(cookieHeader);

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        streamRecovery.startMonitoring();

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        // Process MCP tool invocations first
        let processedMessages = await mcpService.processToolInvocations(messages, dataStream);

        // Process agent tool invocations when agent mode is enabled
        if (useAgentMode) {
          processedMessages = await processAgentToolInvocations(processedMessages, dataStream);
        }

        if (processedMessages.length > 3) {
          messageSliceId = processedMessages.length - 3;
        }

        const shouldOptimizeContext = filePaths.length > 0 && contextOptimization && processedMessages.length > 3;

        if (!shouldOptimizeContext && filePaths.length > 0 && contextOptimization) {
          logger.info(
            `Skipping context optimization for short chat (${processedMessages.length} messages ≤ 3) — using all files`,
          );
          filteredFiles = files;
        }

        if (shouldOptimizeContext) {
          logger.debug('Generating Chat Summary + Selecting Context (parallel)');

          const optimizationStart = performance.now();
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Analysing Request',
          } satisfies ProgressAnnotation);

          logger.debug(`Messages count: ${processedMessages.length}`);

          /*
           * Run createSummary and selectContext in parallel.
           * selectContext uses the summary as a hint, but works without one.
           * Running them concurrently saves 5-10s per request.
           */
          const summaryPromise = createSummary({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          }).catch((err) => {
            logger.warn('createSummary failed — continuing without summary:', err);

            return undefined;
          });

          const contextPromise = selectContext({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            files: files || {},
            providerSettings,
            promptId,
            contextOptimization,
            summary: '', // summary runs in parallel — selectContext works without one
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          }).catch((err) => {
            logger.warn('selectContext failed — falling back to all files:', err);

            return files;
          });

          const [summaryResult, contextResult] = await Promise.all([summaryPromise, contextPromise]);

          summary = summaryResult;
          filteredFiles = contextResult;

          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Analysis Complete',
          } satisfies ProgressAnnotation);

          if (summary) {
            dataStream.writeMessageAnnotation({
              type: 'chatSummary',
              summary,
              chatId: processedMessages.slice(-1)?.[0]?.id,
            } as ContextAnnotation);
          }

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);

            dataStream.writeMessageAnnotation({
              type: 'codeContext',
              files: Object.keys(filteredFiles).map((key) => {
                let path = key;

                if (path.startsWith(WORK_DIR)) {
                  path = path.replace(WORK_DIR, '');
                }

                return path;
              }),
            } as ContextAnnotation);
          }

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          } satisfies ProgressAnnotation);

          logger.info(
            `⏱ Total context optimization (parallel): ${(performance.now() - optimizationStart).toFixed(0)}ms`,
          );
        }

        // Merge MCP tools with agent tools when agent mode is enabled
        let combinedTools = mcpService.toolsWithoutExecute;

        if (useAgentMode) {
          logger.info('🤖 Agent mode enabled - merging agent tools');

          const agentTools = getAgentToolSetWithoutExecute();
          const agentToolNames = Object.keys(agentTools);
          const mcpToolNames = Object.keys(mcpService.toolsWithoutExecute);
          logger.info(`🔧 MCP tools available: ${mcpToolNames.length} - [${mcpToolNames.join(', ')}]`);
          logger.info(`🔧 Agent tools available: ${agentToolNames.length} - [${agentToolNames.join(', ')}]`);
          combinedTools = { ...mcpService.toolsWithoutExecute, ...agentTools };
          logger.info(`🔧 Combined tools total: ${Object.keys(combinedTools).length}`);

          // Initialize agent session for this chat
          initializeAgentSession();

          // Notify about agent mode activation
          dataStream.writeData({
            type: 'progress',
            label: 'agent',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Agent Mode Active',
          } satisfies ProgressAnnotation);
        }

        const options: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: combinedTools,
          maxSteps: maxLLMSteps,
          agentMode: useAgentMode,
          onStepFinish: ({ toolCalls }) => {
            // add tool call annotations for frontend processing
            toolCalls.forEach((toolCall) => {
              // Check if it's an agent tool first
              if (useAgentMode && isAgentToolName(toolCall.toolName)) {
                processAgentToolCall(toolCall, dataStream);

                // Increment iteration counter for agent mode
                incrementAgentIteration();

                // Check for iteration warning
                const warning = getAgentIterationWarning();

                if (warning) {
                  logger.warn('Agent iteration warning:', warning);
                }
              } else {
                // Process as MCP tool
                mcpService.processToolCall(toolCall, dataStream);
              }
            });
          },
          onFinish: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            const lastUserMessage = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];

            const { model, provider } = lastUserMessage
              ? extractPropertiesFromMessage(lastUserMessage)
              : { model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER.name };
            processedMessages.push({ id: generateId(), role: 'assistant', content });
            processedMessages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              enableThinking,
              contextFiles: filteredFiles,
              chatMode,
              designScheme,
              planMode,
              summary,
              messageSliceId,
            });

            result.mergeIntoDataStream(dataStream, { sendReasoning: enableThinking });

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error = part.error;
                  logger.error(`${error}`);

                  return;
                }
              }
            })().catch((err) => {
              logger.error('Continuation stream iteration failed:', err);
            });

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const streamStart = performance.now();

        const result = await streamText({
          messages: [...processedMessages],
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          enableThinking,
          contextFiles: filteredFiles,
          chatMode,
          designScheme,
          planMode,
          summary,
          messageSliceId,
        });

        (async () => {
          for await (const part of result.fullStream) {
            streamRecovery.updateActivity();

            if (part.type === 'error') {
              const error = part.error;
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.error('Streaming error:', error);
              streamRecovery.stop();

              // Enhanced error handling for common streaming issues
              if (errorMessage.includes('Invalid JSON response')) {
                logger.error('Invalid JSON response detected - likely malformed API response');
              } else if (errorMessage.includes('token')) {
                logger.error('Token-related error detected - possible token limit exceeded');
              }

              return;
            }
          }
          streamRecovery.stop();
          logger.info(`⏱ streamText completed in ${(performance.now() - streamStart).toFixed(0)}ms`);
        })().catch((err) => {
          streamRecovery.stop();
          logger.error('Stream iteration failed:', err);
        });
        result.mergeIntoDataStream(dataStream, { sendReasoning: enableThinking });
      },
      onError: (error: unknown) => {
        // Provide more specific error messages for common issues
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
        }

        if (
          errorMessage.includes('API key') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('authentication')
        ) {
          return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
        }

        if (errorMessage.includes('token') && errorMessage.includes('limit')) {
          return 'Custom error: Token limit exceeded. The conversation is too long for the selected model. Try using a model with larger context window or start a new conversation.';
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          return 'Custom error: API rate limit exceeded. Please wait a moment before trying again.';
        }

        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          return 'Custom error: Network error. Please check your internet connection and try again.';
        }

        return `Custom error: ${errorMessage}`;
      },
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          if (!lastChunk) {
            lastChunk = ' ';
          }

          if (typeof chunk === 'string') {
            if (chunk.startsWith('g') && !lastChunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "<div class=\\"__devonzThought__\\">"\n`));
            }

            if (lastChunk.startsWith('g') && !chunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "</div>\\n"\n`));
            }
          }

          lastChunk = chunk;

          let transformedChunk = chunk;

          if (typeof chunk === 'string' && chunk.startsWith('g')) {
            let content = chunk.split(':').slice(1).join(':');

            if (content.endsWith('\n')) {
              content = content.slice(0, content.length - 1);
            }

            transformedChunk = `0:${content}\n`;
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
        },
      }),
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: unknown) {
    logger.error(error);

    const errMsg = error instanceof Error ? error.message : String(error);
    const errObj = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;

    const errorResponse = {
      error: true,
      message: errMsg || 'An unexpected error occurred',
      statusCode: (errObj.statusCode as number) || 500,
      isRetryable: errObj.isRetryable !== false, // Default to retryable unless explicitly false
      provider: (errObj.provider as string) || 'unknown',
    };

    if (errMsg?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}
