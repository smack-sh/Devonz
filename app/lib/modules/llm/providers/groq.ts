import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export default class GroqProvider extends BaseProvider {
  name = 'Groq';
  getApiKeyLink = 'https://console.groq.com/keys';

  config = {
    apiTokenKey: 'GROQ_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Essential fallback models - only the most stable/reliable ones
     * Llama 3.1 8B: 128k context, fast and efficient
     */
    {
      name: 'llama-3.1-8b-instant',
      label: 'Llama 3.1 8B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },

    // Llama 3.3 70B: 128k context, most capable model
    {
      name: 'llama-3.3-70b-versatile',
      label: 'Llama 3.3 70B',
      provider: 'Groq',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 8192,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Env,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'GROQ_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing Api Key configuration for ${this.name} provider`);
    }

    const response = await fetch(`https://api.groq.com/openai/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: this.createTimeoutSignal(5000),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const res = (await response.json()) as {
      data: Array<{ id: string; object?: string; active?: boolean; context_window?: number; owned_by?: string }>;
    };

    const data = res.data.filter(
      (model) => model.object === 'model' && model.active && (model.context_window ?? 0) > 8000,
    );

    return data.map((m) => ({
      name: m.id,
      label: `${m.id} - context ${m.context_window ? Math.floor(m.context_window / 1000) + 'k' : 'N/A'} [ by ${m.owned_by}]`,
      provider: this.name,
      maxTokenAllowed: Math.min(m.context_window || 8192, 16384),
      maxCompletionTokens: 8192,
    }));
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'GROQ_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey,
    });

    return openai(model);
  }
}
