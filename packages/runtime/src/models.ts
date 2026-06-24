/**
 * Only two models per local policy: DeepSeek-V4-Flash (default) and
 * ZenMux Gemini-3.1-flash. Both are reached via OpenAI-compatible endpoints,
 * expressed as Mastra custom-provider model configs.
 */

export type ModelKey = 'deepseek' | 'zenmux';

export interface ModelConfig {
  providerId: string;
  modelId: string;
  url: string;
  apiKey: string;
}

export interface RuntimeModelOverrides {
  openaiApiKeyEnabled?: boolean;
  openaiApiKey?: string;
  overrideOpenAIBaseUrl?: boolean;
  openaiBaseUrl?: string;
}

let runtimeOverrides: RuntimeModelOverrides = {};

export function setRuntimeModelOverrides(overrides: RuntimeModelOverrides): void {
  runtimeOverrides = { ...overrides };
}

function applyOpenAICompatibleOverrides(config: ModelConfig): ModelConfig {
  return {
    ...config,
    apiKey:
      runtimeOverrides.openaiApiKeyEnabled && runtimeOverrides.openaiApiKey?.trim()
        ? runtimeOverrides.openaiApiKey.trim()
        : config.apiKey,
    url:
      runtimeOverrides.overrideOpenAIBaseUrl && runtimeOverrides.openaiBaseUrl?.trim()
        ? runtimeOverrides.openaiBaseUrl.trim()
        : config.url,
  };
}

export function getModelConfig(key: ModelKey): ModelConfig {
  if (key === 'zenmux') {
    return applyOpenAICompatibleOverrides({
      providerId: 'zenmux',
      modelId: process.env.ZENMUX_MODEL ?? 'google/gemini-3.1-flash-lite-preview',
      url: process.env.ZENMUX_BASE_URL ?? 'https://zenmux.ai/api/v1',
      apiKey: process.env.ZENMUX_API_KEY ?? '',
    });
  }
  return applyOpenAICompatibleOverrides({
    providerId: 'deepseek',
    modelId: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    url: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  });
}

export const DEFAULT_MODEL: ModelKey = 'deepseek';
