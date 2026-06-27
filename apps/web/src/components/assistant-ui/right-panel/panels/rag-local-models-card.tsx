import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SettingsSwitch } from '@/components/features/settings/settings-switch';
import { apiUrl } from '@/lib/api-base';

type DownloadPhase = 'idle' | 'downloading' | 'ready' | 'error';

export type LocalModel = {
  id: 'embedding' | 'reranker';
  kind: 'embedding' | 'reranker';
  required: boolean;
  modelId: string;
  installed: boolean;
  enabled?: boolean;
  available?: boolean;
  download: {
    phase: DownloadPhase;
    progress: number;
    message: string;
    file?: string;
    error?: string | null;
  };
  lastError?: string | null;
};

const FALLBACK_MODELS: LocalModel[] = [
  {
    id: 'embedding',
    kind: 'embedding',
    required: true,
    modelId: 'BAAI/bge-small-en-v1.5',
    installed: false,
    download: { phase: 'idle', progress: 0, message: '' },
  },
  {
    id: 'reranker',
    kind: 'reranker',
    required: false,
    modelId: 'Xenova/ms-marco-MiniLM-L-6-v2',
    installed: false,
    available: true,
    download: { phase: 'idle', progress: 0, message: '' },
  },
];

async function fetchLocalModels(): Promise<{ models: LocalModel[]; hfEndpoint: string | null }> {
  const res = await fetch(apiUrl('/api/rag/local-models'));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { models: LocalModel[]; hfEndpoint?: string | null };
  return { models: body.models ?? [], hfEndpoint: body.hfEndpoint ?? null };
}

function ModelRow({
  model,
  onRefresh,
}: {
  model: LocalModel;
  onRefresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'download' | 'remove' | 'toggle' | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const phase = model.download.phase;
  const showProgress = phase === 'downloading';
  const showReady = model.installed && phase !== 'downloading' && phase !== 'error';
  const showError = phase === 'error' || Boolean(model.lastError && !model.installed);
  const titleKey = model.id === 'embedding' ? 'rag.localModels.embeddingTitle' : 'rag.localModels.rerankerTitle';
  const descKey = model.id === 'embedding' ? 'rag.localModels.embeddingDesc' : 'rag.localModels.rerankerDesc';

  async function onDownload() {
    setBusy('download');
    setRowError(null);
    try {
      const res = await fetch(apiUrl(`/api/rag/local-models/${model.id}/download`), { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onToggleEnabled(enabled: boolean) {
    setBusy('toggle');
    setRowError(null);
    try {
      const res = await fetch(apiUrl(`/api/rag/local-models/${model.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setBusy('remove');
    setRowError(null);
    try {
      const res = await fetch(apiUrl(`/api/rag/local-models/${model.id}`), { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      await onRefresh();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (model.id === 'reranker' && model.available === false) {
    return null;
  }

  return (
    <div className="border-border bg-background/70 rounded-lg border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="text-xs font-medium">{t(titleKey)}</div>
            {model.required ? (
              <span className="bg-amber-500/10 text-amber-700 rounded-full px-1.5 py-0.5 text-[10px]">
                {t('rag.localModels.required')}
              </span>
            ) : (
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                {t('rag.localModels.optional')}
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{t(descKey)}</div>
          <div className="text-muted-foreground mt-1 truncate font-mono text-[10px]">{model.modelId}</div>
        </div>
        {showReady && model.id === 'reranker' ? (
          <SettingsSwitch
            checked={model.enabled === true}
            onChange={(on) => {
              if (busy === 'toggle') return;
              void onToggleEnabled(on);
            }}
            label={t('rag.localModels.enableReranker')}
            className={busy === 'toggle' ? 'pointer-events-none shrink-0 opacity-60' : 'shrink-0'}
          />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {showReady ? (
          <span className="border-emerald-500/25 bg-emerald-500/10 text-emerald-600 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
            <CheckCircle2 className="size-3" />
            {t('rag.localModels.statusReady')}
          </span>
        ) : showProgress ? (
          <span className="border-amber-500/25 bg-amber-500/10 text-amber-600 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
            <Loader2 className="size-3 animate-spin" />
            {t('rag.localModels.statusDownloading', { progress: model.download.progress })}
          </span>
        ) : showError ? (
          <span className="border-destructive/25 bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
            <CircleAlert className="size-3" />
            {t('rag.localModels.statusFailed')}
          </span>
        ) : (
          <span className="border-border bg-muted/50 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]">
            {t('rag.localModels.statusNotInstalled')}
          </span>
        )}

        {!showReady && !showProgress ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy === 'download'}
            onClick={() => void onDownload()}
          >
            {busy === 'download' ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
            {t('rag.localModels.download')}
          </Button>
        ) : null}

        {showReady ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive h-7 gap-1 px-2 text-[11px]"
            disabled={busy === 'remove'}
            onClick={() => void onRemove()}
          >
            {busy === 'remove' ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            {t('rag.localModels.remove')}
          </Button>
        ) : null}
      </div>

      {showProgress ? (
        <div className="mt-2">
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, model.download.progress))}%` }}
            />
          </div>
          <div className="text-muted-foreground mt-1 truncate text-[10px]">
            {model.download.file ||
              (model.download.message === 'extract'
                ? t('rag.localModels.extracting')
                : model.download.message)}
          </div>
        </div>
      ) : null}

      {showError ? (
        <div className="text-destructive mt-2 text-[11px] leading-relaxed">
          {model.download.error || model.lastError}
        </div>
      ) : null}

      {rowError ? <div className="text-destructive mt-2 text-[11px]">{rowError}</div> : null}
    </div>
  );
}

export type RagLocalModelsCardHandle = {
  refresh: () => Promise<unknown>;
};

export const RagLocalModelsCard = forwardRef<RagLocalModelsCardHandle>(function RagLocalModelsCard(
  _props,
  ref,
) {
  const { t } = useTranslation();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [hfEndpoint, setHfEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchLocalModels();
      setModels(next.models);
      setHfEndpoint(next.hfEndpoint);
      setActionError(null);
      setLoading(false);
      return next;
    } catch (err) {
      setModels((prev) => (prev.length > 0 ? prev : FALLBACK_MODELS));
      setActionError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      return null;
    }
  }, []);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDownloading = models.some((model) => model.download.phase === 'downloading');

  useEffect(() => {
    if (!isDownloading) return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [isDownloading, refresh]);

  if (loading && models.length === 0) {
    return (
      <div className="border-border bg-muted/20 mt-3 rounded-xl border px-3 py-2.5">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          {t('rag.localModels.loading')}
        </div>
      </div>
    );
  }

  const visibleModels = models.filter((model) => model.id !== 'reranker' || model.available !== false);
  const displayModels = visibleModels.length > 0 ? visibleModels : FALLBACK_MODELS;

  return (
    <div className="border-border bg-muted/20 rounded-xl border px-3 py-2.5">
      <div>
        <div className="text-xs font-medium">{t('rag.localModels.title')}</div>
        <div className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{t('rag.localModels.subtitle')}</div>
        {hfEndpoint ? (
          <div className="text-muted-foreground mt-1 font-mono text-[10px]">
            {t('rag.localModels.hfEndpoint', { endpoint: hfEndpoint })}
          </div>
        ) : null}
      </div>
      {actionError ? (
        <div className="border-destructive/20 bg-destructive/10 text-destructive mt-2 rounded-md border px-2 py-1.5 text-[11px]">
          {actionError}
        </div>
      ) : null}
      <div className="mt-2 space-y-2">
        {displayModels.map((model) => (
          <ModelRow key={model.id} model={model} onRefresh={refresh} />
        ))}
      </div>
    </div>
  );
});
