import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import { setModelSettings, type ModelCatalogEntry } from '@/lib/model-settings';
import { notifyModelProviderChange } from '@/lib/model-availability';
import type { ModelProviderSettings } from '@/hooks/settings/api';

const LEGACY_MODEL_IDS = new Set([
  'deepseek-v3-2',
  'deepseek-chat',
  'compass-1',
  'deepseek',
  'zenmux',
]);

type CatalogResponse = {
  models: Array<{ id: string; label: string; default?: boolean }>;
  defaultId: string | null;
};

let serverCatalog: ModelCatalogEntry[] = [];

export function isServerModelCatalogActive(): boolean {
  return serverCatalog.length > 0;
}

export function getServerModelCatalog(): ModelCatalogEntry[] {
  return serverCatalog;
}

function applyServerCatalog(data: CatalogResponse): ModelCatalogEntry[] {
  const models = data.models.map((m) => ({ id: m.id, label: m.label }));
  serverCatalog = models;

  setModelSettings({
    models,
    enabledModels: Object.fromEntries(models.map((m) => [m.id, true])),
  });

  const defaultId = data.defaultId ?? models[0]!.id;
  const active = getChatSettings().model;
  if (!active || LEGACY_MODEL_IDS.has(active) || !models.some((m) => m.id === active)) {
    setChatSettings({ model: defaultId });
  }

  const provider: ModelProviderSettings = {
    modelName: models.find((m) => m.id === defaultId)?.label ?? models[0]!.label,
    requestUrl: 'local-catalog',
    hasApiKey: true,
    configured: true,
  };
  notifyModelProviderChange(provider);
  return models;
}

/** Sync model list from server models.local.json — always overwrites stale localStorage. */
export async function bootstrapModelCatalogFromServer(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/model-catalog'), { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as CatalogResponse;
    if (!data.models?.length) return false;
    applyServerCatalog(data);
    return true;
  } catch {
    return false;
  }
}

/** Keep model picker in sync with the server catalog (refetch on mount). */
export function useServerModelCatalog(): {
  models: ModelCatalogEntry[];
  loading: boolean;
} {
  const [models, setModels] = useState<ModelCatalogEntry[]>(() => serverCatalog);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void bootstrapModelCatalogFromServer()
      .then((ok) => {
        if (cancelled) return;
        if (ok) setModels(getServerModelCatalog());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading };
}
