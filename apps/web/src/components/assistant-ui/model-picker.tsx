import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getChatSettings, setChatSettings, onChatSettingsChange, type ModelKey } from '@/lib/chat-settings';
import {
  listEnabledModels,
  onModelSettingsChange,
  type ModelCatalogEntry,
} from '@/lib/model-settings';

export type { ModelKey };

export function getSelectedModel(): ModelKey {
  return getChatSettings().model;
}

/** Composer model picker — shows the models the user enabled in Settings. */
export function ModelPicker({ className }: { className?: string }) {
  const [model, setModel] = useState<ModelKey>(() => getSelectedModel());
  const [models, setModels] = useState<ModelCatalogEntry[]>(() => listEnabledModels());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      setModel(getSelectedModel());
      setModels(listEnabledModels());
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

  if (!current) {
    return (
      <span className="text-muted-foreground px-2 text-xs">No models enabled</span>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-7 gap-0.5 whitespace-nowrap rounded-full px-2 text-xs font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        {current.label}
        <ChevronDownIcon className="size-3 opacity-60" />
      </Button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            aria-label="Close model menu"
            onClick={() => setOpen(false)}
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
