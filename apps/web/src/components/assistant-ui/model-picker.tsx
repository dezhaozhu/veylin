import { ChevronDownIcon } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getChatSettings, setChatSettings, onChatSettingsChange, type ModelKey } from '@/lib/chat-settings';
import { onModelSettingsChange } from '@/lib/model-settings';
import { listConfiguredModels } from '@/lib/model-availability';
import { useModelProvider } from '@/hooks/use-model-provider';
import { useServerModelCatalog } from '@/hooks/use-server-model-catalog';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';
import {
  ComposerTriggerMenuShell,
  type MenuAnchor,
} from '@/components/assistant-ui/composer-mention/composer-menu-shared';

export type { ModelKey };

export function getSelectedModel(): ModelKey {
  return getChatSettings().model;
}

function useModelPickerAnchor(open: boolean, anchorRef: RefObject<HTMLElement | null>) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }

    const updateAnchor = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setAnchor({
        left: rect.left,
        width: Math.max(180, rect.width),
        bottom: window.innerHeight - rect.top + 8,
      });
    };

    updateAnchor();
    const stopLayout = subscribeLayoutSync(updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      stopLayout();
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [open, anchorRef]);

  return anchor;
}

/** Composer model picker — only shows models with a configured API key. */
export function ModelPicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const { provider, loading: providerLoading } = useModelProvider();
  const { models: serverModels, loading: catalogLoading } = useServerModelCatalog();
  const [model, setModel] = useState<ModelKey>(() => getSelectedModel());
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const anchor = useModelPickerAnchor(open, anchorRef);

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
    <div ref={anchorRef} className={cn('relative min-w-0 shrink-0', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-7 min-w-0 max-w-[5.5rem] gap-0.5 rounded-full px-2 text-xs font-normal sm:max-w-[7.5rem]"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
      </Button>
      {open && anchor ? (
        <ComposerTriggerMenuShell
          open={open}
          anchor={anchor}
          ariaLabel={t('settings.models.title', { defaultValue: 'Model' })}
          closeLabel="Close model menu"
          onClose={close}
          maxHeight="max-h-60"
        >
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
        </ComposerTriggerMenuShell>
      ) : null}
    </div>
  );
}
