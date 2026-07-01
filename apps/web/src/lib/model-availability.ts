import type { ModelKey } from '@/lib/chat-settings';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import {
  catalogEntryFromModelName,
  listEnabledModels,
  type ModelCatalogEntry,
} from '@/lib/model-settings';
import { getServerModelCatalog, isServerModelCatalogActive } from '@/hooks/use-server-model-catalog';
import { settingsApi, type ModelProviderSettings } from '@/hooks/settings/api';

export const MODEL_PROVIDER_CHANGE_EVENT = 'veylin-model-provider-change';

export type ProviderCatalogContext = Pick<ModelProviderSettings, 'configured' | 'modelName'>;

/** Models available when provider settings are saved (user catalog only). */
export function listConfiguredModels(provider: ProviderCatalogContext): ModelCatalogEntry[] {
  if (!provider.configured) return [];

  if (isServerModelCatalogActive()) {
    return getServerModelCatalog();
  }

  const enabled = listEnabledModels();
  if (enabled.length > 0) return enabled;

  const name = provider.modelName.trim();
  return name ? [catalogEntryFromModelName(name)] : [];
}

export function isCatalogModelConfigured(
  id: string,
  provider: ProviderCatalogContext,
): boolean {
  return listConfiguredModels(provider).some((m) => m.id === id);
}

export function ensureActiveModelConfigured(provider: ProviderCatalogContext): void {
  const enabled = listConfiguredModels(provider);
  if (enabled.length === 0) return;
  const current = getChatSettings().model;
  if (enabled.some((m) => m.id === current)) return;
  setChatSettings({ model: enabled[0]!.id as ModelKey });
}

export function notifyModelProviderChange(settings: ModelProviderSettings): void {
  window.dispatchEvent(new CustomEvent(MODEL_PROVIDER_CHANGE_EVENT, { detail: settings }));
}

export async function fetchModelProviderSettings(): Promise<ModelProviderSettings> {
  const { settings } = await settingsApi.getModelSettings();
  return settings;
}
