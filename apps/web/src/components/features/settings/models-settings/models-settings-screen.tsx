import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, RefreshCw, Search } from 'lucide-react';
import { SettingsSwitch } from '../settings-switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { settingsApi, type ModelProviderSettings } from '@/hooks/settings/api';
import {
  addCustomModel,
  getModelSettings,
  listCatalogModels,
  onModelSettingsChange,
  setModelEnabled,
  type ModelCatalogEntry,
} from '@/lib/model-settings';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function ModelsSettingsScreen() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(() => getModelSettings());
  const [activeModel, setActiveModel] = useState(() => getChatSettings().model);
  const [provider, setProvider] = useState<ModelProviderSettings>({
    openaiApiKeyEnabled: false,
    hasOpenaiApiKey: false,
    overrideOpenAIBaseUrl: false,
    openaiBaseUrl: '',
  });
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeysOpen, setApiKeysOpen] = useState(true);
  const [savingProvider, setSavingProvider] = useState(false);

  useEffect(() => onModelSettingsChange(setSettings), []);
  useEffect(() => {
    void settingsApi
      .getModelSettings()
      .then((r) => setProvider(r.settings))
      .catch(() => undefined);
  }, []);

  const catalog = useMemo(() => listCatalogModels(), [settings]);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      catalog.filter(
        (m) => !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
      ),
    [catalog, q],
  );

  const canAdd =
    q.length > 0 &&
    !catalog.some(
      (m) => m.label.toLowerCase() === q || m.id.toLowerCase() === q.replace(/\s+/g, '-'),
    );

  const toggleModel = useCallback((id: string, enabled: boolean) => {
    setModelEnabled(id, enabled);
    if (!enabled && activeModel === id) {
      const next = listCatalogModels().find((m) => m.id !== id && getModelSettings().enabledModels[m.id] !== false);
      if (next) {
        setActiveModel(next.id);
        setChatSettings({ model: next.id });
      }
    }
  }, [activeModel]);

  const selectModel = (id: string) => {
    if (getModelSettings().enabledModels[id] === false) return;
    setActiveModel(id);
    setChatSettings({ model: id });
  };

  const handleAdd = () => {
    const added = addCustomModel(query.trim());
    if (added) setQuery('');
  };

  const resetCatalog = () => {
    for (const m of catalog) {
      setModelEnabled(m.id, true);
    }
  };

  const saveProvider = async (
    patch: Partial<ModelProviderSettings> & { openaiApiKey?: string },
  ) => {
    setSavingProvider(true);
    try {
      const { settings: next } = await settingsApi.updateModelSettings(patch);
      setProvider(next);
      if (patch.openaiApiKey != null) setApiKeyDraft('');
    } finally {
      setSavingProvider(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('settings.models.title')}</h1>

      <div className="border-border bg-card rounded-xl border">
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add or search model"
              className="h-9 border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canAdd) handleAdd();
              }}
            />
          </div>
          {canAdd ? (
            <Button type="button" size="sm" variant="ghost" className="shrink-0 gap-1" onClick={handleAdd}>
              <Plus className="size-3.5" />
              Add
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label="Reset enabled models"
              onClick={resetCatalog}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          )}
        </div>

        <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
          {filtered.length === 0 && !canAdd && (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">No models match your search.</p>
          )}
          {filtered.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              enabled={settings.enabledModels[model.id] !== false}
              active={activeModel === model.id}
              onToggle={(on) => toggleModel(model.id, on)}
              onSelect={() => selectModel(model.id)}
            />
          ))}
          {canAdd && (
            <button
              type="button"
              className="hover:bg-accent/50 border-border flex w-full items-center gap-2 border-t px-4 py-3 text-left text-sm"
              onClick={handleAdd}
            >
              <Plus className="text-muted-foreground size-4" />
              <span>
                Add <span className="font-medium">{query.trim()}</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <section className="mt-7">
        <button
          type="button"
          className="mb-4 flex items-center gap-2 text-left text-sm font-medium"
          onClick={() => setApiKeysOpen((o) => !o)}
        >
          <ChevronDown
            className={cn('size-4 transition-transform', !apiKeysOpen && '-rotate-90')}
          />
          API Keys
        </button>

        {apiKeysOpen && (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">OpenAI API Key</div>
                <p className="text-muted-foreground mt-1 text-sm">
                  Veylin desktop packages do not include model credentials. Add your own
                  OpenAI-compatible key here to use the configured models.
                  {provider.hasOpenaiApiKey && !apiKeyDraft && (
                    <span className="ml-1 text-emerald-600">Key configured.</span>
                  )}
                </p>
              </div>
              <SettingsSwitch
                checked={provider.openaiApiKeyEnabled}
                onChange={(on) => {
                  setProvider((p) => ({ ...p, openaiApiKeyEnabled: on }));
                  void saveProvider({ openaiApiKeyEnabled: on });
                }}
                label="Toggle OpenAI API key"
                className="mt-0.5"
              />
            </div>

            <div className="bg-muted/60 rounded-xl p-3">
              <Input
                type="password"
                value={apiKeyDraft}
                placeholder={
                  provider.hasOpenaiApiKey ? 'OpenAI API Key is configured' : 'Enter your OpenAI API Key'
                }
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onBlur={() => {
                  if (apiKeyDraft.trim()) void saveProvider({ openaiApiKey: apiKeyDraft.trim() });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && apiKeyDraft.trim()) {
                    void saveProvider({ openaiApiKey: apiKeyDraft.trim() });
                  }
                }}
                className="h-10 border-0 bg-background shadow-none focus-visible:ring-0"
              />
            </div>

            <div className="bg-muted/60 flex items-start gap-4 rounded-xl p-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Override OpenAI Base URL</div>
                <p className="text-muted-foreground mt-1 text-sm">
                  Change the base URL for OpenAI-compatible API requests.
                </p>
                {provider.overrideOpenAIBaseUrl && (
                  <Input
                    value={provider.openaiBaseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(e) =>
                      setProvider((p) => ({ ...p, openaiBaseUrl: e.target.value }))
                    }
                    onBlur={() => void saveProvider({ openaiBaseUrl: provider.openaiBaseUrl })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void saveProvider({ openaiBaseUrl: provider.openaiBaseUrl });
                      }
                    }}
                    className="mt-3 h-10 border-0 bg-background shadow-none focus-visible:ring-0"
                  />
                )}
              </div>
              <SettingsSwitch
                checked={provider.overrideOpenAIBaseUrl}
                onChange={(on) => {
                  setProvider((p) => ({ ...p, overrideOpenAIBaseUrl: on }));
                  void saveProvider({ overrideOpenAIBaseUrl: on });
                }}
                label="Toggle OpenAI base URL override"
                className="mt-0.5"
              />
            </div>
            {savingProvider && (
              <p className="text-muted-foreground text-xs">Saving model settings…</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ModelRow({
  model,
  enabled,
  active,
  onToggle,
  onSelect,
}: {
  model: ModelCatalogEntry;
  enabled: boolean;
  active: boolean;
  onToggle: (on: boolean) => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        'border-border flex items-center gap-3 border-b px-4 py-3 last:border-b-0',
        active && enabled && 'bg-accent/30',
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
        disabled={!enabled}
      >
        <div className="truncate text-sm font-medium">{model.label}</div>
        {!model.builtin && (
          <div className="text-muted-foreground truncate text-xs">{model.id}</div>
        )}
      </button>
      {active && enabled && (
        <span className="text-muted-foreground text-[10px] font-medium uppercase">Active</span>
      )}
      <SettingsSwitch
        checked={enabled}
        onChange={onToggle}
        label={`Toggle ${model.label}`}
      />
    </div>
  );
}
