import type { ModelKey } from '@/lib/chat-settings';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';

export type ModelCatalogEntry = {
  id: string;
  label: string;
  builtin?: boolean;
};

export const BUILTIN_MODELS: ModelCatalogEntry[] = [
  { id: 'deepseek', label: 'DeepSeek-V4-Flash', builtin: true },
  { id: 'zenmux', label: 'Gemini-3.1-flash', builtin: true },
];

export type ModelSettings = {
  customModels: ModelCatalogEntry[];
  enabledModels: Record<string, boolean>;
};

const KEY = 'veylin-model-settings';
const EVENT = 'veylin-model-settings';

const DEFAULTS: ModelSettings = {
  customModels: [],
  enabledModels: Object.fromEntries(BUILTIN_MODELS.map((m) => [m.id, true])),
};

export function getModelSettings(): ModelSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS, enabledModels: { ...DEFAULTS.enabledModels } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return { ...DEFAULTS, enabledModels: { ...DEFAULTS.enabledModels } };
    }
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    const enabledModels = { ...DEFAULTS.enabledModels, ...(parsed.enabledModels ?? {}) };
    for (const m of BUILTIN_MODELS) {
      if (enabledModels[m.id] === undefined) enabledModels[m.id] = true;
    }
    return {
      customModels: parsed.customModels ?? [],
      enabledModels,
    };
  } catch {
    return { ...DEFAULTS, enabledModels: { ...DEFAULTS.enabledModels } };
  }
}

export function setModelSettings(patch: Partial<ModelSettings>): ModelSettings {
  const current = getModelSettings();
  const next: ModelSettings = {
    customModels: patch.customModels ?? current.customModels,
    enabledModels: patch.enabledModels
      ? { ...current.enabledModels, ...patch.enabledModels }
      : current.enabledModels,
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
  const { customModels } = getModelSettings();
  const seen = new Set<string>();
  const out: ModelCatalogEntry[] = [];
  for (const m of [...BUILTIN_MODELS, ...customModels]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export function isModelEnabled(id: string): boolean {
  return getModelSettings().enabledModels[id] !== false;
}

export function setModelEnabled(id: string, enabled: boolean): void {
  setModelSettings({ enabledModels: { [id]: enabled } });
}

export function addCustomModel(label: string): ModelCatalogEntry | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const id = slugModelId(trimmed);
  const catalog = listCatalogModels();
  if (catalog.some((m) => m.id === id || m.label.toLowerCase() === trimmed.toLowerCase())) {
    return catalog.find((m) => m.id === id || m.label.toLowerCase() === trimmed.toLowerCase()) ?? null;
  }
  const entry: ModelCatalogEntry = { id, label: trimmed };
  const { customModels } = getModelSettings();
  setModelSettings({
    customModels: [...customModels, entry],
    enabledModels: { [id]: true },
  });
  return entry;
}

function slugModelId(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || `model-${Date.now()}`;
}

function ensureActiveModelEnabled(settings: ModelSettings): void {
  const catalog = [...BUILTIN_MODELS, ...settings.customModels];
  const enabled = catalog.filter((m) => settings.enabledModels[m.id] !== false);
  if (enabled.length === 0) return;
  const current = getChatSettings().model;
  if (settings.enabledModels[current] !== false) return;
  const fallback = enabled.find((m) => m.builtin)?.id ?? enabled[0]!.id;
  if (fallback === current) return;
  setChatSettings({ model: fallback as ModelKey });
}

export function listEnabledModels(): ModelCatalogEntry[] {
  return listCatalogModels().filter((m) => isModelEnabled(m.id));
}
