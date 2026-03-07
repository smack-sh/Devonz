import { generateText, type CoreTool, type GenerateTextResult, type Message } from 'ai';
import { createHash } from 'node:crypto';
import type { IProviderSetting } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { extractCurrentContext, extractPropertiesFromMessage, simplifyDevonzActions } from './utils';
import { createScopedLogger } from '~/utils/logger';
import { resolveModel } from './resolve-model';

const logger = createScopedLogger('create-summary');

/**
 * In-memory cache for summaries keyed by a hash of sliced message content.
 * Prevents redundant LLM calls when the same messages are reprocessed
 * (e.g. rapid re-sends or continuation requests with identical history).
 */
const summaryCache = new Map<string, { summary: string; timestamp: number }>();
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SUMMARY_CACHE_MAX_SIZE = 50; // Cap to prevent unbounded memory growth

export async function createSummary(props: {
  messages: Message[];
  env?: Env;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  onFinish?: (resp: GenerateTextResult<Record<string, CoreTool<any, any>>, never>) => void;
}) {
  const { messages, env: serverEnv, apiKeys, providerSettings, onFinish } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return { ...message, content };
    } else if (message.role === 'assistant') {
      let content = message.content;

      content = simplifyDevonzActions(content);
      content = content.replace(/<div class=\\"__devonzThought__\\">.*?<\/div>/s, '');
      content = content.replace(/<think>.*?<\/think>/s, '');

      return { ...message, content };
    }

    return message;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const resolvedModel = await resolveModel({
    provider,
    currentModel,
    apiKeys,
    providerSettings,
    serverEnv,
    logger,
  });

  // Use resolved model name (may differ from requested if fallback occurred)
  currentModel = resolvedModel.name;

  let slicedMessages = processedMessages;
  const { summary } = extractCurrentContext(processedMessages);
  let summaryText: string | undefined = undefined;
  let chatId: string | undefined = undefined;

  if (summary && summary.type === 'chatSummary') {
    chatId = summary.chatId;
    summaryText = `Below is the Chat Summary till now, this is chat summary before the conversation provided by the user 
you should also use this as historical message while providing the response to the user.        
${summary.summary}`;

    if (chatId) {
      let index = 0;

      for (let i = 0; i < processedMessages.length; i++) {
        if (processedMessages[i].id === chatId) {
          index = i;
          break;
        }
      }
      slicedMessages = processedMessages.slice(index + 1);
    }
  }

  logger.debug('Sliced Messages:', slicedMessages.length);

  const extractTextContent = (message: Message) =>
    Array.isArray(message.content)
      ? (message.content.find((item) => item.type === 'text')?.text as string) || ''
      : message.content;

  // --- Hash-based cache: skip LLM call if sliced messages + old summary are identical ---
  const cacheInput = (summaryText || '') + slicedMessages.map((m) => `${m.role}:${extractTextContent(m)}`).join('|');
  const cacheKey = createHash('sha256').update(cacheInput).digest('hex');

  // Evict stale entries
  for (const [key, entry] of summaryCache) {
    if (Date.now() - entry.timestamp > SUMMARY_CACHE_TTL_MS) {
      summaryCache.delete(key);
    }
  }

  const cached = summaryCache.get(cacheKey);

  if (cached) {
    logger.info(`Summary cache HIT — skipping LLM call (hash: ${cacheKey.slice(0, 8)}…)`);

    return cached.summary;
  }

  logger.info(`Summary cache MISS — calling LLM (hash: ${cacheKey.slice(0, 8)}…)`);

  // select files from the list of code file from the project that might be useful for the current request from the user
  const resp = await generateText({
    system: `
        You are a software engineer. You are working on a project. you need to summarize the work till now and provide a summary of the chat till now.

        Please only use the following format to generate the summary:
---
# Project Overview
- **Project**: {project_name} - {brief_description}
- **Current Phase**: {phase}
- **Tech Stack**: {languages}, {frameworks}, {key_dependencies}
- **Environment**: {critical_env_details}

# Conversation Context
- **Last Topic**: {main_discussion_point}
- **Key Decisions**: {important_decisions_made}
- **User Context**:
  - Technical Level: {expertise_level}
  - Preferences: {coding_style_preferences}
  - Communication: {preferred_explanation_style}

# Implementation Status
## Current State
- **Active Feature**: {feature_in_development}
- **Progress**: {what_works_and_what_doesn't}
- **Blockers**: {current_challenges}

## Code Evolution
- **Recent Changes**: {latest_modifications}
- **Working Patterns**: {successful_approaches}
- **Failed Approaches**: {attempted_solutions_that_failed}

# Requirements
- **Implemented**: {completed_features}
- **In Progress**: {current_focus}
- **Pending**: {upcoming_features}
- **Technical Constraints**: {critical_constraints}

# Critical Memory
- **Must Preserve**: {crucial_technical_context}
- **User Requirements**: {specific_user_needs}
- **Known Issues**: {documented_problems}

# Next Actions
- **Immediate**: {next_steps}
- **Open Questions**: {unresolved_issues}

---
Note:
4. Keep entries concise and focused on information needed for continuity


---
        
        RULES:
        * Only provide the whole summary of the chat till now.
        * Do not provide any new information.
        * DO not need to think too much just start writing imidiately
        * do not write any thing other that the summary with with the provided structure
        `,
    prompt: `

Here is the previous summary of the chat:
<old_summary>
${summaryText} 
</old_summary>

Below is the chat after that:
---
<new_chats>
${slicedMessages
  .map((x) => {
    return `---\n[${x.role}] ${extractTextContent(x)}\n---`;
  })
  .join('\n')}
</new_chats>
---

Please provide a summary of the chat till now including the hitorical summary of the chat.
`,
    model: provider.getModelInstance({
      model: currentModel,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
  });

  const response = resp.text;

  // Store in cache for future identical requests (evict oldest if over cap)
  if (summaryCache.size >= SUMMARY_CACHE_MAX_SIZE) {
    const oldestKey = summaryCache.keys().next().value;

    if (oldestKey !== undefined) {
      summaryCache.delete(oldestKey);
    }
  }

  summaryCache.set(cacheKey, { summary: response, timestamp: Date.now() });

  if (onFinish) {
    onFinish(resp);
  }

  return response;
}
