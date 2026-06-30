import {
  DEFAULT_MODEL,
  getModelConfig,
  getRuntimeModelOverrides,
  isModelProviderConfigured,
  isRuntimeModelConfigured,
  setRuntimeModelOverrides,
  type ModelConfig,
  type ModelKey,
  type RuntimeModelOverrides,
} from '@veylin/shared/node';
import {
  clearModelCatalogCache,
  getCatalogModel,
  getDefaultCatalogModel,
  listModelCatalogPublic,
  loadModelCatalog,
  normalizeOpenAICompatibleUrl,
  type ModelCatalogEntry,
} from '@veylin/shared/node';

export {
  loadModelCatalog,
  listModelCatalogPublic,
  getDefaultCatalogModel,
  getCatalogModel,
  normalizeOpenAICompatibleUrl,
  clearModelCatalogCache,
  DEFAULT_MODEL,
  getModelConfig,
  setRuntimeModelOverrides,
  getRuntimeModelOverrides,
  isModelProviderConfigured,
  isRuntimeModelConfigured,
};

export type { ModelCatalogEntry, ModelConfig, ModelKey, RuntimeModelOverrides };
