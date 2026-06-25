import { Plug, Sparkles, ScrollText, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomizeTab } from '@/hooks/settings/use-settings-panel';
import { cn } from '@/lib/utils';

const ITEMS: {
  id: CustomizeTab;
  labelKey: 'customize.skills' | 'customize.rules' | 'customize.mcp';
  icon: typeof Sparkles;
}[] = [
  { id: 'rules', labelKey: 'customize.rules', icon: ScrollText },
  { id: 'skills', labelKey: 'customize.skills', icon: Sparkles },
  { id: 'mcp', labelKey: 'customize.mcp', icon: Plug },
];

export function CustomizeSubNav({
  tab,
  onTab,
}: {
  tab: CustomizeTab;
  onTab: (t: CustomizeTab) => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="border-border bg-muted/20 flex w-52 shrink-0 flex-col border-r">
      <div className="border-border border-b px-4 py-3">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t('customize.title')}
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {ITEMS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              tab === id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0 opacity-80" />
            {t(labelKey)}
          </button>
        ))}
        <button
          type="button"
          disabled
          className="text-muted-foreground flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm opacity-60"
        >
          <Puzzle className="size-4 shrink-0" />
          <span className="flex-1">{t('customize.plugins')}</span>
          <span className="bg-muted rounded-full px-1.5 py-0.5 text-[10px] font-medium">
            {t('customize.soon')}
          </span>
        </button>
      </nav>
    </aside>
  );
}
