import { BookOpen, Globe, Table, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PANEL_KINDS } from './panel-registry';
import type { PanelKind } from './panel-types';

const EMPTY_ICONS: Record<PanelKind, typeof Table> = {
  table: Table,
  web: Globe,
  rag: BookOpen,
  workflow: Workflow,
};

/** Centered 2×2 launcher when the right panel has no open tabs. */
export function PanelEmptyState({
  onOpen,
}: {
  onOpen: (kind: PanelKind) => void | Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="grid w-full max-w-[17.5rem] grid-cols-2 gap-2.5">
        {PANEL_KINDS.map((def) => {
          const Icon = EMPTY_ICONS[def.kind];
          return (
            <button
              key={def.kind}
              type="button"
              onClick={() => onOpen(def.kind)}
              className={cn(
                'bg-card text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                'border-border flex aspect-square flex-col items-center justify-center gap-2.5',
                'rounded-xl border transition-colors',
              )}
            >
              <Icon className="size-6 stroke-[1.5]" aria-hidden />
              <span className="text-xs font-medium">{t(def.label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
