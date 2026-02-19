import { convertToCoreMessages, streamText as _streamText, type Message } from 'ai';
import {
  MAX_TOKENS,
  PROVIDER_COMPLETION_LIMITS,
  isReasoningModel,
  getThinkingProviderOptions,
  type FileMap,
} from './constants';
import { getFineTunedPrompt } from '~/lib/common/prompts/new-prompt';
import { AGENT_MODE_FULL_SYSTEM_PROMPT } from '~/lib/agent/prompts';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage } from './utils';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import type { DesignScheme } from '~/types/design-scheme';
import { resolveModel } from './resolve-model';

export type Messages = Message[];

export interface StreamingOptions extends Omit<Parameters<typeof _streamText>[0], 'model'> {
  supabaseConnection?: {
    isConnected: boolean;
    hasSelectedProject: boolean;
    credentials?: {
      anonKey?: string;
      supabaseUrl?: string;
    };
  };
  agentMode?: boolean;
  agentSystemPrompt?: string;
}

const logger = createScopedLogger('stream-text');

function getCompletionTokenLimit(modelDetails: ModelInfo): number {
  // 1. If model specifies completion tokens, use that
  if (modelDetails.maxCompletionTokens && modelDetails.maxCompletionTokens > 0) {
    return modelDetails.maxCompletionTokens;
  }

  // 2. Use provider-specific default
  const providerDefault = PROVIDER_COMPLETION_LIMITS[modelDetails.provider];

  if (providerDefault) {
    return providerDefault;
  }

  // 3. Final fallback to MAX_TOKENS, but cap at reasonable limit for safety
  return Math.min(MAX_TOKENS, 16384);
}

function sanitizeText(text: string): string {
  let sanitized = text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
  sanitized = sanitized.replace(/<think>.*?<\/think>/s, '');
  sanitized = sanitized.replace(/<boltAction type="file" filePath="package-lock\.json">[\s\S]*?<\/boltAction>/g, '');

  return sanitized.trim();
}

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  enableThinking?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  chatMode?: 'discuss' | 'build';
  designScheme?: DesignScheme;
  planMode?: boolean;
}) {
  const {
    messages,
    env: serverEnv,
    options,
    apiKeys,
    files,
    providerSettings,
    promptId,
    contextOptimization,
    contextFiles,
    summary,
    chatMode,
    designScheme,
  } = props;
  const planMode = props.planMode ?? false;
  const enableThinking = props.enableThinking ?? false;

  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  let processedMessages = messages.map((message) => {
    const newMessage = { ...message };

    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;
      newMessage.content = sanitizeText(content);
    } else if (message.role == 'assistant') {
      newMessage.content = sanitizeText(message.content);
    }

    // Sanitize all text parts in parts array, if present
    if (Array.isArray(message.parts)) {
      newMessage.parts = message.parts.map((part) =>
        part.type === 'text' ? { ...part, text: sanitizeText(part.text) } : part,
      );
    }

    return newMessage;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const modelDetails = await resolveModel({
    provider,
    currentModel,
    apiKeys,
    providerSettings,
    serverEnv,
    logger,
  });

  const dynamicMaxTokens = modelDetails ? getCompletionTokenLimit(modelDetails) : Math.min(MAX_TOKENS, 16384);

  // Use model-specific limits directly - no artificial cap needed
  const safeMaxTokens = dynamicMaxTokens;

  logger.info(
    `Token limits for model ${modelDetails.name}: maxTokens=${safeMaxTokens}, maxTokenAllowed=${modelDetails.maxTokenAllowed}, maxCompletionTokens=${modelDetails.maxCompletionTokens}`,
  );

  let systemPrompt =
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
      designScheme,
      supabase: {
        isConnected: options?.supabaseConnection?.isConnected || false,
        hasSelectedProject: options?.supabaseConnection?.hasSelectedProject || false,
        credentials: options?.supabaseConnection?.credentials || undefined,
      },
    }) ?? getFineTunedPrompt(WORK_DIR);

  if (chatMode === 'build' && contextFiles && contextOptimization) {
    const codeContext = createFilesContext(contextFiles, true);

    systemPrompt = `${systemPrompt}

    Below is the artifact containing the context loaded into context buffer for you to have knowledge of and might need changes to fullfill current user request.
    CONTEXT BUFFER:
    ---
    ${codeContext}
    ---
    `;

    if (summary) {
      systemPrompt = `${systemPrompt}
      below is the chat history till now
      CHAT SUMMARY:
      ---
      ${props.summary}
      ---
      `;

      if (props.messageSliceId) {
        processedMessages = processedMessages.slice(props.messageSliceId);
      } else {
        const lastMessage = processedMessages.pop();

        if (lastMessage) {
          processedMessages = [lastMessage];
        }
      }
    }
  }

  const effectiveLockedFilePaths = new Set<string>();

  if (files) {
    for (const [filePath, fileDetails] of Object.entries(files)) {
      if (fileDetails?.isLocked) {
        effectiveLockedFilePaths.add(filePath);
      }
    }
  }

  if (effectiveLockedFilePaths.size > 0) {
    const lockedFilesListString = Array.from(effectiveLockedFilePaths)
      .map((filePath) => `- ${filePath}`)
      .join('\n');
    systemPrompt = `${systemPrompt}

    IMPORTANT: The following files are locked and MUST NOT be modified in any way. Do not suggest or make any changes to these files. You can proceed with the request but DO NOT make any changes to these files specifically:
    ${lockedFilesListString}
    ---
    `;
  } else {
    logger.debug('No locked files found from any source for prompt.');
  }

  if (planMode) {
    systemPrompt = `${systemPrompt}

<plan_mode>
## CRITICAL: PLANNING MODE IS ACTIVE — TWO-PHASE WORKFLOW

You are in **Plan Mode**. This is a TWO-PHASE workflow. The user will review your plan before you implement anything.

### PHASE 1 — PLAN ONLY (current phase unless told otherwise)
Your ONLY action is to create a file called \`PLAN.md\` in the project root (\`/home/project/PLAN.md\`).

**Rules (NON-NEGOTIABLE):**
1. Create PLAN.md with a markdown checklist of ALL steps needed to fulfill the request.
2. Each step MUST be a checkbox: \`- [ ] Step description\`
3. Steps should be specific, actionable, and ordered logically.
4. **DO NOT create, modify, or delete ANY other files.**
5. **DO NOT run ANY shell commands.**
6. **DO NOT write ANY code other than PLAN.md.**
7. After creating PLAN.md, STOP. Do not continue with implementation.
8. End your response with: "📋 Plan ready for review. Approve to begin implementation."

### PHASE 2 — EXECUTE (only when user says to execute)
When the user sends a message like "execute the plan", "approved", or "go ahead":
1. Read the existing PLAN.md (the user may have modified it).
2. Implement each step in order, creating/editing files and running commands as needed.
3. After completing each step, update PLAN.md to mark it done: \`- [x] Step description\`
4. Continue until all steps are marked complete.

### Example PLAN.md content:
\`\`\`markdown
# Plan

- [ ] Set up project structure with Vite + React
- [ ] Create main App component with counter state
- [ ] Add increment, decrement, and reset buttons
- [ ] Style the counter component
- [ ] Add basic tests
\`\`\`

**REMEMBER: Right now you are in PHASE 1. Create PLAN.md ONLY. Do NOT implement anything yet.**
</plan_mode>
`;
  }

  // PROJECT.md: Persistent project memory - read from project root if exists
  const projectMemoryPaths = ['/home/project/PROJECT.md', '/home/project/BOLT.md', '/home/project/AGENTS.md'];
  let projectMemoryContent: string | undefined;

  for (const memoryPath of projectMemoryPaths) {
    const memoryFile = files?.[memoryPath];

    if (memoryFile?.type === 'file' && memoryFile.content && memoryFile.content.trim().length > 0) {
      projectMemoryContent = memoryFile.content;
      logger.info(`Loaded project memory from: ${memoryPath}`);
      break;
    }
  }

  if (projectMemoryContent) {
    systemPrompt = `${systemPrompt}

<project_memory>
The following are project-specific instructions from the user's PROJECT.md (or BOLT.md/AGENTS.md) file. You MUST follow these instructions for this project:

${projectMemoryContent}
</project_memory>
`;
  }

  logger.info(`Sending llm call to ${provider.name} with model ${modelDetails.name}`);

  // Log reasoning model detection and token parameters
  const isReasoning = isReasoningModel(modelDetails.name);
  logger.info(
    `Model "${modelDetails.name}" is reasoning model: ${isReasoning}, using ${isReasoning ? 'maxCompletionTokens' : 'maxTokens'}: ${safeMaxTokens}`,
  );

  // Validate token limits before API call
  if (safeMaxTokens > (modelDetails.maxTokenAllowed || 128000)) {
    logger.warn(
      `Token limit warning: requesting ${safeMaxTokens} tokens but model supports max ${modelDetails.maxTokenAllowed || 128000}`,
    );
  }

  // Use maxCompletionTokens for reasoning models (o1, GPT-5), maxTokens for traditional models
  const tokenParams = isReasoning ? { maxCompletionTokens: safeMaxTokens } : { maxTokens: safeMaxTokens };

  // Build providerOptions for extended thinking (Anthropic / Google)
  let thinkingProviderOptions: ReturnType<typeof getThinkingProviderOptions> | undefined;

  if (enableThinking) {
    thinkingProviderOptions = getThinkingProviderOptions(provider.name, modelDetails.name, safeMaxTokens);

    if (thinkingProviderOptions) {
      logger.info(
        `Extended thinking enabled for ${provider.name}/${modelDetails.name}:`,
        JSON.stringify(thinkingProviderOptions),
      );
    } else {
      logger.info(`Extended thinking requested but not supported for ${provider.name}/${modelDetails.name}`);
    }
  }

  // Filter out unsupported parameters for reasoning models
  const filteredOptions =
    isReasoning && options
      ? Object.fromEntries(
          Object.entries(options).filter(
            ([key]) =>
              ![
                'temperature',
                'topP',
                'presencePenalty',
                'frequencyPenalty',
                'logprobs',
                'topLogprobs',
                'logitBias',
              ].includes(key),
          ),
        )
      : options || {};

  // DEBUG: Log filtered options
  logger.info(
    `DEBUG STREAM: Options filtering for model "${modelDetails.name}":`,
    JSON.stringify(
      {
        isReasoning,
        originalOptions: options || {},
        filteredOptions,
        originalOptionsKeys: options ? Object.keys(options) : [],
        filteredOptionsKeys: Object.keys(filteredOptions),
        removedParams: options ? Object.keys(options).filter((key) => !(key in filteredOptions)) : [],
      },
      null,
      2,
    ),
  );

  /*
   * AGENT MODE: Replace system prompt entirely when agent mode is enabled
   * This ensures the AI uses agent tools instead of artifacts
   */
  if (options?.agentMode) {
    logger.info('🤖 Agent Mode: Using agent-specific system prompt (replacing standard prompt)');
    systemPrompt = AGENT_MODE_FULL_SYSTEM_PROMPT(WORK_DIR);

    // Add context files if available
    if (chatMode === 'build' && contextFiles && contextOptimization) {
      const codeContext = createFilesContext(contextFiles, true);
      systemPrompt = `${systemPrompt}

<context_buffer>
Below are the current project files loaded into context:
---
${codeContext}
---
</context_buffer>
`;
    }
  }

  // Filter out empty assistant messages (can occur from aborted requests)
  const cleanedMessages = processedMessages.filter(
    (m) => !(m.role === 'assistant' && typeof m.content === 'string' && !m.content.trim()),
  );

  const streamParams = {
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
    system: chatMode === 'build' ? systemPrompt : discussPrompt(),
    ...tokenParams,
    messages: convertToCoreMessages(cleanedMessages as any),
    ...filteredOptions,

    // Set temperature to 1 for reasoning models (required by OpenAI API)
    ...(isReasoning ? { temperature: 1 } : {}),

    // Inject provider-specific thinking options (Anthropic thinking / Google thinkingConfig)
    ...(thinkingProviderOptions ? { providerOptions: thinkingProviderOptions } : {}),
  };

  // DEBUG: Log final streaming parameters
  logger.info(
    `DEBUG STREAM: Final streaming params for model "${modelDetails.name}":`,
    JSON.stringify(
      {
        hasTemperature: 'temperature' in streamParams,
        hasMaxTokens: 'maxTokens' in streamParams,
        hasMaxCompletionTokens: 'maxCompletionTokens' in streamParams,
        paramKeys: Object.keys(streamParams).filter((key) => !['model', 'messages', 'system'].includes(key)),
        streamParams: Object.fromEntries(
          Object.entries(streamParams).filter(([key]) => !['model', 'messages', 'system'].includes(key)),
        ),
      },
      null,
      2,
    ),
  );

  return await _streamText(streamParams);
}
