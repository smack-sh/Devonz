import { createScopedLogger } from '~/utils/logger';
import type { ModelInfo } from '~/lib/modules/llm/types';

const logger = createScopedLogger('ModelRouter');

/**
 * Operation types that can be routed to specific provider+model pairs.
 * Each type represents a distinct phase of LLM interaction.
 */
export const OPERATION_TYPES = [
  'code_generation',
  'planning',
  'error_correction',
  'summarization',
  'general',
  'blueprint',
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export interface ModelRouteConfig {
  provider: string;
  model: string;
}

/**
 * Per-operation model routing configuration.
 * Keys are operation types, values are provider+model assignments.
 * Missing keys mean "use the default model" (the currently selected one).
 */
export type ModelRoutingConfig = Partial<Record<OperationType, ModelRouteConfig>>;

/**
 * Validates whether a string is a known operation type.
 */
export function isValidOperationType(value: string): value is OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value);
}

/**
 * Resolves the provider+model pair for a given operation type.
 *
 * Resolution order:
 * 1. If userRoutingConfig has an entry for the operation type with both provider and model set, use it.
 * 2. Otherwise, fall back to the default model (currentProvider + currentModel from the chat).
 *
 * @param operationType - The type of operation being performed
 * @param userRoutingConfig - Per-operation overrides from user settings (may be undefined/empty)
 * @param defaultProvider - The user's currently selected provider in the chat
 * @param defaultModel - The user's currently selected model in the chat
 * @returns The resolved {provider, model} pair
 */
export function resolveModelForOperation(
  operationType: string,
  userRoutingConfig: ModelRoutingConfig | undefined | null,
  defaultProvider: string,
  defaultModel: string,
): ModelRouteConfig {
  const fallback: ModelRouteConfig = { provider: defaultProvider, model: defaultModel };

  if (!operationType) {
    logger.warn('Empty operation type provided, using default model');
    return fallback;
  }

  if (!isValidOperationType(operationType)) {
    logger.warn(`Unknown operation type "${operationType}", using default model`);
    return fallback;
  }

  if (!userRoutingConfig) {
    logger.debug(`No routing config, using default for "${operationType}"`);
    return fallback;
  }

  const override = userRoutingConfig[operationType];

  if (!override || !override.provider || !override.model) {
    logger.debug(`No override for "${operationType}", using default model`);
    return fallback;
  }

  logger.info(`Routing "${operationType}" to ${override.provider}/${override.model}`);

  return { provider: override.provider, model: override.model };
}

/**
 * Parses a fallback model string ("provider/model") into a ModelRouteConfig.
 * Returns null if the model has no fallback configured or the format is invalid.
 *
 * @param modelDetails - The ModelInfo for the primary model (may have fallbackModel set)
 * @returns Parsed provider + model pair, or null if no fallback is configured
 */
export function parseFallbackModel(modelDetails: ModelInfo): ModelRouteConfig | null {
  if (!modelDetails.fallbackModel) {
    return null;
  }

  const slashIndex = modelDetails.fallbackModel.indexOf('/');

  if (slashIndex <= 0 || slashIndex === modelDetails.fallbackModel.length - 1) {
    logger.warn(`Invalid fallback model format "${modelDetails.fallbackModel}" — expected "provider/model"`);
    return null;
  }

  const provider = modelDetails.fallbackModel.slice(0, slashIndex);
  const model = modelDetails.fallbackModel.slice(slashIndex + 1);

  return { provider, model };
}
