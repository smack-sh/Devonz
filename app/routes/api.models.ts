import type { LoaderFunctionArgs } from 'react-router';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';

import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { withSecurity } from '~/lib/security';

let cachedProviders: ProviderInfo[] | null = null;
let cachedDefaultProvider: ProviderInfo | null = null;

/** Server-side model list cache with short TTL to avoid repeated fetches during startup */
let cachedModelResponse: { models: ModelInfo[]; timestamp: number } | null = null;
const MODEL_CACHE_TTL_MS = 30_000; // 30 seconds

function getProviderInfo(llmManager: LLMManager) {
  if (!cachedProviders) {
    cachedProviders = llmManager.getAllProviders().map((provider) => ({
      name: provider.name,
      staticModels: provider.staticModels,
      getApiKeyLink: provider.getApiKeyLink,
      labelForGetApiKey: provider.labelForGetApiKey,
      icon: provider.icon,
    }));
  }

  if (!cachedDefaultProvider) {
    const defaultProvider = llmManager.getDefaultProvider();
    cachedDefaultProvider = {
      name: defaultProvider.name,
      staticModels: defaultProvider.staticModels,
      getApiKeyLink: defaultProvider.getApiKeyLink,
      labelForGetApiKey: defaultProvider.labelForGetApiKey,
      icon: defaultProvider.icon,
    };
  }

  return { providers: cachedProviders, defaultProvider: cachedDefaultProvider };
}

async function modelsLoader({ request, params, context }: LoaderFunctionArgs): Promise<Response> {
  const serverEnv = (context as { cloudflare?: { env?: Record<string, string> } })?.cloudflare?.env;
  const llmManager = LLMManager.getInstance(serverEnv);

  // Get client side maintained API keys and provider settings from cookies
  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  const { providers, defaultProvider } = getProviderInfo(llmManager);

  let modelList: ModelInfo[] = [];

  if (params.provider) {
    // Only update models for the specific provider
    const provider = llmManager.getProvider(params.provider);

    if (provider) {
      modelList = await llmManager.getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv,
      });
    }
  } else if (cachedModelResponse && Date.now() - cachedModelResponse.timestamp < MODEL_CACHE_TTL_MS) {
    // Return server-side cached model list to avoid repeated fetches during startup
    modelList = cachedModelResponse.models;
  } else {
    // Update all models and cache the result
    modelList = await llmManager.updateModelList({
      apiKeys,
      providerSettings,
      serverEnv,
    });
    cachedModelResponse = { models: modelList, timestamp: Date.now() };
  }

  return Response.json({
    modelList,
    providers,
    defaultProvider,
  });
}

export const loader = withSecurity(modelsLoader, {
  allowedMethods: ['GET'],
  rateLimit: false,
});
