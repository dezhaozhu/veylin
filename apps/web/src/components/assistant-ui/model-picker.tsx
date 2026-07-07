import { ChevronDownIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { cn } from '@/lib/utils';
import { getChatSettings, setChatSettings, onChatSettingsChange, type ModelKey } from '@/lib/chat-settings';
import { onModelSettingsChange } from '@/lib/model-settings';
import { listConfiguredModels } from '@/lib/model-availability';
import { useModelProvider } from '@/hooks/use-model-provider';
import { useServerModelCatalog } from '@/hooks/use-server-model-catalog';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';

export type { ModelKey };

export function getSelectedModel(): ModelKey {
  return getChatSettings().model;
}

/** Composer model picker — only shows models with a configured API key. */
export function ModelPicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { provider, loading: providerLoading } = useModelProvider();
  const { models: serverModels, loading: catalogLoading } = useServerModelCatalog();
  const [model, setModel] = useState<ModelKey>(() => getSelectedModel());
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  useOverlayDismiss(close);

  const models = useMemo(() => {
    if (serverModels.length > 0) return serverModels;
    return listConfiguredModels(provider);
  }, [serverModels, provider, catalogVersion]);

  const loading = providerLoading || catalogLoading;

  useEffect(() => {
    const sync = () => {
      setModel(getSelectedModel());
      setCatalogVersion((v) => v + 1);
    };
    const offChat = onChatSettingsChange(sync);
    const offModels = onModelSettingsChange(sync);
    return () => {
      offChat();
      offModels();
    };
  }, []);

  const current = models.find((m) => m.id === model) ?? models[0];

  const choose = (id: ModelKey) => {
    setModel(id);
    setChatSettings({ model: id });
    setOpen(false);
  };

  if (loading) {
    return <span className="text-muted-foreground px-2 text-xs">…</span>;
  }

  if (!current) {
    return (
      <span className="text-muted-foreground px-2 text-xs">
        {t('settings.models.notConfigured')}
      </span>
    );
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-7 min-w-0 max-w-[5.5rem] gap-0.5 rounded-full px-2 text-xs font-normal sm:max-w-[7.5rem]"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
      </Button>
      {open && (
        <>
          <DismissibleBackdrop
            ariaLabel="Close model menu"
            onClose={close}
            className="fixed inset-0 z-40"
          />
          <div className="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-1 min-w-[180px] rounded-lg border p-1 shadow-md">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  'hover:bg-accent w-full rounded-md px-2.5 py-1.5 text-left text-xs',
                  m.id === model && 'bg-accent',
                )}
                onClick={() => choose(m.id as ModelKey)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
