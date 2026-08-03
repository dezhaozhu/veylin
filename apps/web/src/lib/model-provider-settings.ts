import type { ModelProviderSettings } from '@/hooks/settings/api';
import { listConfiguredModels } from '@/lib/model-availability';

type RawModelProviderSettings = Partial<ModelProviderSettings>;

function resolveConfigured(raw: RawModelProviderSettings): boolean {
  if (typeof raw.configured === 'boolean') return raw.configured;
  return Boolean(
    raw.hasApiKey && raw.modelName?.trim() && raw.requestUrl?.trim(),
  );
}

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
