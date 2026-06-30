import type { ModelKey } from '@/lib/chat-settings';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';

export type ModelCatalogEntry = {
  id: string;
  label: string;
};

export type ModelSettings = {
  models: ModelCatalogEntry[];
  enabledModels: Record<string, boolean>;
};

const KEY = 'veylin-model-settings';
const EVENT = 'veylin-model-settings';

function sanitizeEnabledModels(
  models: ModelCatalogEntry[],
  raw: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const validIds = new Set(models.map((m) => m.id));
  const enabledModels: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(raw ?? {})) {
    if (validIds.has(id)) {
      enabledModels[id] = on;
    }
  }
  for (const m of models) {
    if (enabledModels[m.id] === undefined) enabledModels[m.id] = true;
  }
  return enabledModels;
}

export function slugModelId(modelName: string): string {
  const slug = modelName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'model';
}

export function catalogEntryFromModelName(modelName: string): ModelCatalogEntry {
  const label = modelName.trim();
  return { id: slugModelId(label), label };
}

export function getModelSettings(): ModelSettings {
  if (typeof window === 'undefined') {
    return { models: [], enabledModels: {} };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { models: [], enabledModels: {} };
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    const models = parsed.models ?? [];
    return {
      models,
      enabledModels: sanitizeEnabledModels(models, parsed.enabledModels),
    };
  } catch {
    return { models: [], enabledModels: {} };
  }
}

export function setModelSettings(patch: Partial<ModelSettings>): ModelSettings {
  const current = getModelSettings();
  const models = patch.models ?? current.models;
  const next: ModelSettings = {
    models,
    enabledModels: patch.enabledModels
      ? sanitizeEnabledModels(models, { ...current.enabledModels, ...patch.enabledModels })
      : sanitizeEnabledModels(models, current.enabledModels),
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  ensureActiveModelEnabled(next);
  return next;
}

export function onModelSettingsChange(cb: (s: ModelSettings) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ModelSettings>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function listCatalogModels(): ModelCatalogEntry[] {
  return getModelSettings().models;
}

export function isModelEnabled(id: string): boolean {
  return getModelSettings().enabledModels[id] !== false;
}

export function setModelEnabled(id: string, enabled: boolean): void {
  setModelSettings({ enabledModels: { [id]: enabled } });
}

export function upsertCatalogModel(modelName: string): ModelCatalogEntry {
  const entry = catalogEntryFromModelName(modelName);
  const settings = getModelSettings();
  const models = [...settings.models.filter((m) => m.id !== entry.id), entry];
  setModelSettings({
    models,
    enabledModels: { ...settings.enabledModels, [entry.id]: true },
  });
  return entry;
}

export function removeCatalogModel(id: string): boolean {
  const settings = getModelSettings();
  if (!settings.models.some((m) => m.id === id)) return false;
  const models = settings.models.filter((m) => m.id !== id);
  const enabledModels = { ...settings.enabledModels };
  delete enabledModels[id];
  setModelSettings({ models, enabledModels });
  return true;
}

function ensureActiveModelEnabled(settings: ModelSettings): void {
  const enabled = settings.models.filter((m) => settings.enabledModels[m.id] !== false);
  if (enabled.length === 0) return;
  const current = getChatSettings().model;
  if (settings.enabledModels[current] !== false && settings.models.some((m) => m.id === current)) {
    return;
  }
  const fallback = enabled[0]!.id;
  if (fallback === current) return;
  setChatSettings({ model: fallback as ModelKey });
}

export function listEnabledModels(): ModelCatalogEntry[] {
  return listCatalogModels().filter((m) => isModelEnabled(m.id));
}
