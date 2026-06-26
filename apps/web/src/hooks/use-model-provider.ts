import { useCallback, useEffect, useState } from 'react';
import {
  ensureActiveModelConfigured,
  fetchModelProviderSettings,
  MODEL_PROVIDER_CHANGE_EVENT,
} from '@/lib/model-availability';
import { upsertCatalogModel } from '@/lib/model-settings';
import type { ModelProviderSettings } from '@/hooks/settings/api';

const DEFAULT_PROVIDER: ModelProviderSettings = {
  modelName: '',
  requestUrl: '',
  hasApiKey: false,
  configured: false,
};

export function useModelProvider() {
  const [provider, setProvider] = useState<ModelProviderSettings>(DEFAULT_PROVIDER);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchModelProviderSettings();
      if (next.configured && next.modelName.trim()) {
        upsertCatalogModel(next.modelName);
      }
      setProvider(next);
      ensureActiveModelConfigured(next);
      return next;
    } catch {
      setProvider(DEFAULT_PROVIDER);
      return DEFAULT_PROVIDER;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ModelProviderSettings>).detail;
      if (detail && 'configured' in detail) {
        if (detail.configured && detail.modelName.trim()) {
          upsertCatalogModel(detail.modelName);
        }
        setProvider(detail);
        ensureActiveModelConfigured(detail);
        setLoading(false);
        return;
      }
      void refresh();
    };
    window.addEventListener(MODEL_PROVIDER_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(MODEL_PROVIDER_CHANGE_EVENT, onChange);
  }, [refresh]);

  return {
    provider,
    configured: provider.configured,
    loading,
    refresh,
  };
}
