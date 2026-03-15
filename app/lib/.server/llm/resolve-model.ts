import type { IProviderSetting } from '~/types/model';
import type { BaseProvider } from '~/lib/modules/llm/base-provider';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';

interface ResolveModelOptions {
  provider: BaseProvider;
  currentModel: string;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  serverEnv?: Env;
  logger: { warn: (msg: string) => void };
}

/**
 * Resolves a model by name from a provider's static or dynamic model lists.
 * Falls back to the first available model if the requested model is not found.
 *
 * This is shared across create-summary, select-context, stream-text, and
 * the model fallback chain to eliminate duplicated resolution boilerplate.
 * When a fallback model is configured (e.g. "anthropic/claude-3-haiku-20240307"),
 * stream-text.ts parses the provider/model string and calls this function
 * to resolve the fallback model through the same path as the primary.
 */
export async function resolveModel(options: ResolveModelOptions): Promise<ModelInfo> {
  const { provider, currentModel, apiKeys, providerSettings, serverEnv, logger } = options;

  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      // Provider-specific error messages for common mistakes
      if (provider.name === 'Google' && currentModel.includes('2.5')) {
        throw new Error(
          `Model "${currentModel}" not found. Gemini 2.5 Pro doesn't exist. Available Gemini models include: gemini-1.5-pro, gemini-2.0-flash, gemini-1.5-flash. Please select a valid model.`,
        );
      }

      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  return modelDetails;
}
