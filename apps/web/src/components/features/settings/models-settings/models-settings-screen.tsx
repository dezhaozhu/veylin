import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Search, Trash2 } from 'lucide-react';
import { SettingsSwitch } from '../settings-switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { settingsApi, type ModelProviderSettings } from '@/hooks/settings/api';
import {
  getModelSettings,
  onModelSettingsChange,
  removeCatalogModel,
  setModelEnabled,
  upsertCatalogModel,
  type ModelCatalogEntry,
} from '@/lib/model-settings';
import { getChatSettings, setChatSettings } from '@/lib/chat-settings';
import {
  ensureActiveModelConfigured,
  listConfiguredModels,
  notifyModelProviderChange,
} from '@/lib/model-availability';
import {
  isModelSettingsSaved,
} from '@/lib/model-provider-settings';
import { useModelProvider } from '@/hooks/use-model-provider';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function applyProviderToDrafts(
  settings: ModelProviderSettings,
  setProvider: (value: ModelProviderSettings) => void,
  setModelNameDraft: (value: string) => void,
  setRequestUrlDraft: (value: string) => void,
) {
  setProvider(settings);
  setModelNameDraft(settings.modelName);
  setRequestUrlDraft(settings.requestUrl);
}

export function ModelsSettingsScreen() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(() => getModelSettings());
  const [activeModel, setActiveModel] = useState(() => getChatSettings().model);
  const [provider, setProvider] = useState<ModelProviderSettings>({
    modelName: '',
    requestUrl: '',
    hasApiKey: false,
    configured: false,
  });
  const { provider: liveProvider, loading: providerLoading, refresh: refreshProvider } =
    useModelProvider();
  const [modelNameDraft, setModelNameDraft] = useState('');
  const [requestUrlDraft, setRequestUrlDraft] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeysOpen, setApiKeysOpen] = useState(true);
  const [savingProvider, setSavingProvider] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelCatalogEntry | null>(null);
  const [deletingModel, setDeletingModel] = useState(false);
  const hydratedProviderRef = useRef(false);

  useEffect(() => onModelSettingsChange(setSettings), []);
  useEffect(() => {
    if (providerLoading || hydratedProviderRef.current) return;
    applyProviderToDrafts(liveProvider, setProvider, setModelNameDraft, setRequestUrlDraft);
    hydratedProviderRef.current = true;
  }, [liveProvider, providerLoading]);

  const catalogContext = provider.configured ? provider : liveProvider;

  const configuredCatalog = useMemo(
    () => listConfiguredModels(catalogContext),
    [catalogContext, settings],
  );
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      configuredCatalog.filter(
        (m) => !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
      ),
    [configuredCatalog, q],
  );

  const hasApiKey = apiKeyDraft.trim().length > 0 || provider.hasApiKey;

  const canSaveProvider =
    modelNameDraft.trim().length > 0 &&
    requestUrlDraft.trim().length > 0 &&
    hasApiKey;

  const toggleModel = useCallback((id: string, enabled: boolean) => {
    setModelEnabled(id, enabled);
    if (!enabled && activeModel === id) {
      const next = configuredCatalog.find(
        (m) => m.id !== id && getModelSettings().enabledModels[m.id] !== false,
      );
      if (next) {
        setActiveModel(next.id);
        setChatSettings({ model: next.id });
      }
    }
  }, [activeModel, configuredCatalog]);

  const selectModel = (id: string) => {
    if (getModelSettings().enabledModels[id] === false) return;
    if (!listConfiguredModels(catalogContext).some((m) => m.id === id)) return;
    setActiveModel(id);
    setChatSettings({ model: id });
  };

  const resetCatalog = () => {
    for (const m of configuredCatalog) {
      setModelEnabled(m.id, true);
    }
  };

  const confirmDeleteModel = async () => {
    if (!deleteTarget || deletingModel) return;
    setDeletingModel(true);
    setSaveError(null);
    try {
      const { settings: next } = await settingsApi.clearModelSettings();
      applyProviderToDrafts(next, setProvider, setModelNameDraft, setRequestUrlDraft);
      notifyModelProviderChange(next);
      removeCatalogModel(deleteTarget.id);
      ensureActiveModelConfigured(next);
      setApiKeyDraft('');
      await refreshProvider();
      if (activeModel === deleteTarget.id) {
        const nextModel = listConfiguredModels(next)[0];
        if (nextModel) {
          setActiveModel(nextModel.id);
          setChatSettings({ model: nextModel.id });
        } else {
          setActiveModel('');
          setChatSettings({ model: '' });
        }
      }
      setDeleteTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingModel(false);
    }
  };

  const saveProvider = async () => {
    if (!hasApiKey) {
      setSaveError(t('settings.models.apiKeyRequired'));
      return;
    }

    setSavingProvider(true);
    setSaveError(null);
    try {
      const { settings: next } = await settingsApi.updateModelSettings({
        modelName: modelNameDraft.trim(),
        requestUrl: requestUrlDraft.trim(),
        ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
      });
      if (!isModelSettingsSaved(next)) {
        setSaveError(t('settings.models.saveSuccessNoModels'));
        return;
      }

      setProvider(next);
      setModelNameDraft('');
      setRequestUrlDraft('');
      setApiKeyDraft('');
      const entry = upsertCatalogModel(next.modelName);
      setActiveModel(entry.id);
      setChatSettings({ model: entry.id });
      notifyModelProviderChange(next);
      ensureActiveModelConfigured(next);
      await refreshProvider();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t('settings.models.saveFailed'),
      );
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
              placeholder={t('settings.models.searchPlaceholder')}
              className="h-9 border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0"
            />
          </div>
          {configuredCatalog.length > 0 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label={t('settings.models.resetEnabled')}
              onClick={resetCatalog}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          )}
        </div>

        <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              {configuredCatalog.length === 0
                ? t('settings.models.emptyUnconfigured')
                : t('settings.models.noSearchResults')}
            </p>
          )}
          {filtered.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              enabled={settings.enabledModels[model.id] !== false}
              active={activeModel === model.id}
              onToggle={(on) => toggleModel(model.id, on)}
              onSelect={() => selectModel(model.id)}
              onDelete={() => setDeleteTarget(model)}
            />
          ))}
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
          {t('settings.models.providerSection')}
        </button>

        {apiKeysOpen && (
          <div className="space-y-4">
            <ProviderField
              label={t('settings.models.modelName')}
              hint={t('settings.models.modelNameHint')}
              value={modelNameDraft}
              placeholder={t('settings.models.modelNamePlaceholder')}
              onChange={setModelNameDraft}
            />

            <ProviderField
              label={t('settings.models.requestUrl')}
              hint={t('settings.models.requestUrlHint')}
              value={requestUrlDraft}
              placeholder={t('settings.models.requestUrlPlaceholder')}
              onChange={setRequestUrlDraft}
            />

            <div>
              <div className="mb-2 text-sm font-medium">{t('settings.models.apiKey')}</div>
              <p className="text-muted-foreground mb-2 text-xs">{t('settings.models.apiKeyHint')}</p>
              <div className="bg-muted/60 rounded-xl p-3">
                <Input
                  type="password"
                  value={apiKeyDraft}
                  placeholder={t('settings.models.apiKeyPlaceholder')}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  className="h-10 border-0 bg-background shadow-none focus-visible:ring-0"
                />
              </div>
            </div>

            {saveError && (
              <p className="text-destructive text-sm">{saveError}</p>
            )}

            <Button
              type="button"
              className="w-full"
              onClick={() => void saveProvider()}
              disabled={!canSaveProvider || savingProvider}
            >
              {savingProvider ? t('settings.models.saving') : t('settings.models.save')}
            </Button>
          </div>
        )}
      </section>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deletingModel && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.models.deleteModelTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.models.confirmDeleteModel', { name: deleteTarget?.label ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingModel}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDeleteModel()}
              disabled={deletingModel}
            >
              {deletingModel ? t('settings.models.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      {hint && <p className="text-muted-foreground mb-2 text-xs">{hint}</p>}
      <div className="bg-muted/60 rounded-xl p-3">
        <Input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 border-0 bg-background shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function ModelRow({
  model,
  enabled,
  active,
  onToggle,
  onSelect,
  onDelete,
}: {
  model: ModelCatalogEntry;
  enabled: boolean;
  active: boolean;
  onToggle: (on: boolean) => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'group border-border flex items-center gap-2 border-b px-4 py-3 last:border-b-0',
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
      </button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive size-8 shrink-0 opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={t('settings.models.deleteModel', { name: model.label })}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="size-4" />
      </Button>
      <SettingsSwitch
        checked={enabled}
        onChange={onToggle}
        label={`Toggle ${model.label}`}
      />
    </div>
  );
}
