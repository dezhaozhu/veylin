import {
  getCatalogModel,
  getDefaultCatalogModel,
  loadModelCatalog,
} from './model-catalog';

export { loadModelCatalog, listModelCatalogPublic, getDefaultCatalogModel } from './model-catalog';
export type { ModelCatalogEntry } from './model-catalog';

/** Catalog model id selected in chat (built-in or custom). */
export type ModelKey = string;

export interface ModelConfig {
  providerId: string;
  modelId: string;
  url: string;
  apiKey: string;
}

export interface RuntimeModelOverrides {
  modelName?: string;
  requestUrl?: string;
  apiKey?: string;
}

let runtimeOverrides: RuntimeModelOverrides = {};

export function setRuntimeModelOverrides(overrides: RuntimeModelOverrides): void {
  runtimeOverrides = { ...overrides };
}

export function getRuntimeModelOverrides(): RuntimeModelOverrides {
  return { ...runtimeOverrides };
}

function requiresUserModelSettings(): boolean {
  return process.env.VEYLIN_REQUIRE_USER_MODEL_SETTINGS === '1';
}

function resolvedModelName(): string {
  return runtimeOverrides.modelName?.trim() ?? '';
}

export function isModelProviderConfigured(overrides: RuntimeModelOverrides): boolean {
  const apiKey = overrides.apiKey?.trim() ?? '';
  const requestUrl = overrides.requestUrl?.trim() ?? '';
  const modelName = overrides.modelName?.trim() ?? '';
  return Boolean(apiKey && requestUrl && modelName);
}

export function isRuntimeModelConfigured(): boolean {
  if (loadModelCatalog().length > 0) return true;
  return isModelProviderConfigured(runtimeOverrides);
}

function defaultEnvConfig(catalogId: string): ModelConfig {
  return {
    providerId: catalogId,
    modelId: process.env.VEYLIN_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    url: process.env.VEYLIN_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey:
      process.env.VEYLIN_API_KEY ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.ZENMUX_API_KEY ??
      '',
  };
}

function applyOpenAICompatibleOverrides(config: ModelConfig): ModelConfig {
  const configuredApiKey = runtimeOverrides.apiKey?.trim() ?? '';
  const modelName = resolvedModelName();

  return {
    ...config,
    apiKey: configuredApiKey || (requiresUserModelSettings() ? '' : config.apiKey),
    url: runtimeOverrides.requestUrl?.trim() || config.url,
    modelId: modelName || config.modelId,
  };
}

function configFromCatalog(catalogId: ModelKey): ModelConfig | undefined {
  const entry =
    getCatalogModel(catalogId) ??
    (catalogId === DEFAULT_MODEL ? getDefaultCatalogModel() : undefined);
  if (!entry) return undefined;
  return {
    providerId: entry.id,
    modelId: entry.modelId,
    url: entry.url,
    apiKey: entry.apiKey,
  };
}

/** Resolve LLM config for any catalog model id using local catalog or shared provider settings. */
export function getModelConfig(catalogId: ModelKey = DEFAULT_MODEL): ModelConfig {
  const fromCatalog = configFromCatalog(catalogId);
  if (fromCatalog) return fromCatalog;

  const fallbackId = catalogId !== DEFAULT_MODEL ? catalogId : undefined;
  const fromSlug = fallbackId ? getCatalogModel(fallbackId) : undefined;
  if (fromSlug) {
    return {
      providerId: fromSlug.id,
      modelId: fromSlug.modelId,
      url: fromSlug.url,
      apiKey: fromSlug.apiKey,
    };
  }

  return applyOpenAICompatibleOverrides(defaultEnvConfig(catalogId));
}

export const DEFAULT_MODEL = 'default';
