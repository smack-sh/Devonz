import type { JSONValue } from 'ai';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('LLMConstants');

/*
 * Maximum tokens for response generation (updated for modern model capabilities)
 * This serves as a fallback when model-specific limits are unavailable
 * Modern models like Claude 3.5, GPT-4o, and Gemini Pro support 128k+ tokens
 */
export const MAX_TOKENS = 128000;

/*
 * Provider-specific default completion token limits
 * Used as fallbacks when model doesn't specify maxCompletionTokens
 */
export const PROVIDER_COMPLETION_LIMITS: Record<string, number> = {
  OpenAI: 4096, // Standard GPT models (o1 models have much higher limits)
  Github: 4096, // GitHub Models use OpenAI-compatible limits
  Anthropic: 64000, // Conservative limit for Claude 4 models (Opus: 32k, Sonnet: 64k)
  Google: 8192, // Gemini 1.5 Pro/Flash standard limit
  Cohere: 4000,
  DeepSeek: 8192,
  Groq: 8192,
  HuggingFace: 4096,
  Mistral: 8192,
  Ollama: 8192,
  OpenRouter: 8192,
  Perplexity: 8192,
  Together: 8192,
  xAI: 8192,
  LMStudio: 8192,
  OpenAILike: 8192,
  AmazonBedrock: 8192,
  Hyperbolic: 8192,
};

/*
 * Reasoning models that require maxCompletionTokens instead of maxTokens
 * These models use internal reasoning tokens and have different API parameter requirements
 */
export function isReasoningModel(modelName: string): boolean {
  const result =
    /^(o1|o3|gpt-5)/i.test(modelName) ||
    /deepseek[-_]?r1/i.test(modelName) ||
    /qwq/i.test(modelName) ||
    /kimi[-_]?thinking/i.test(modelName);

  logger.debug(`REGEX TEST: "${modelName}" matches reasoning pattern: ${result}`);

  return result;
}

/**
 * Determines if a model supports extended thinking via providerOptions.
 * Returns the appropriate providerOptions object for the given provider/model,
 * or undefined if the model/provider doesn't support extended thinking.
 */
export function getThinkingProviderOptions(
  providerName: string,
  modelName: string,
  maxOutputTokens: number,
): Record<string, Record<string, JSONValue>> | undefined {
  const budgetTokens = Math.max(1024, Math.min(Math.floor(maxOutputTokens * 0.25), 32000));

  if (providerName === 'Anthropic') {
    // Claude 3.5 Sonnet, Claude 4 Opus, Claude 4 Sonnet support extended thinking
    if (/claude/i.test(modelName)) {
      logger.info(`Enabling Anthropic extended thinking for ${modelName} (budget: ${budgetTokens} tokens)`);

      return {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens },
        },
      };
    }
  }

  if (providerName === 'Google') {
    // Gemini 2.5 Pro/Flash and thinking models support thinkingConfig
    if (/gemini-2\.5|gemini-2\.0-flash-thinking/i.test(modelName)) {
      logger.info(`Enabling Google thinking for ${modelName} (budget: ${budgetTokens} tokens)`);

      return {
        google: {
          thinkingConfig: { thinkingBudget: budgetTokens, includeThoughts: true },
        },
      };
    }
  }

  // DeepSeek R1, QWQ, Kimi thinking — thinking is built into the model, no providerOptions needed
  return undefined;
}

/**
 * Calculate the completion token limit for a given model.
 *
 * Priority:
 * 1. Model-specific `maxCompletionTokens`
 * 2. Provider-specific default from `PROVIDER_COMPLETION_LIMITS`
 * 3. Fallback: `min(MAX_TOKENS, 16384)`
 */
export function getCompletionTokenLimit(modelDetails: { maxCompletionTokens?: number; provider: string }): number {
  if (modelDetails.maxCompletionTokens && modelDetails.maxCompletionTokens > 0) {
    return modelDetails.maxCompletionTokens;
  }

  const providerDefault = PROVIDER_COMPLETION_LIMITS[modelDetails.provider];

  if (providerDefault) {
    return providerDefault;
  }

  return Math.min(MAX_TOKENS, 16384);
}

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 2;

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  isLocked?: boolean;
  lockedByFolder?: string;
}

export interface Folder {
  type: 'folder';
  isLocked?: boolean;
  lockedByFolder?: string;
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.json',
  '**/*lock.yml',
];
