import type { ModelProviderSettings } from '@/hooks/settings/api';
import { listConfiguredModels } from '@/lib/model-availability';

type RawModelProviderSettings = Partial<ModelProviderSettings> & {
  modelAvailability?: { deepseek?: boolean; zenmux?: boolean };
};

function resolveConfigured(raw: RawModelProviderSettings): boolean {
  if (typeof raw.configured === 'boolean') return raw.configured;
  const legacy = raw.modelAvailability;
  if (legacy) return Boolean(legacy.deepseek || legacy.zenmux);
  return Boolean(
    raw.hasApiKey && raw.modelName?.trim() && raw.requestUrl?.trim(),
  );
}

/** Normalize API model settings (current server format only). */
export function normalizeModelProviderSettings(
  raw: RawModelProviderSettings,
): ModelProviderSettings {
  return {
    modelName: raw.modelName ?? '',
    requestUrl: raw.requestUrl ?? '',
    hasApiKey: raw.hasApiKey ?? false,
    configured: resolveConfigured(raw),
  };
}

export function listAvailableModelLabels(provider: ModelProviderSettings): string[] {
  return listConfiguredModels(provider).map((m) => m.label);
}

export function isModelSettingsSaved(settings: ModelProviderSettings): boolean {
  return settings.configured;
}
