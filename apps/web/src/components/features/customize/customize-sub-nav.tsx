import { Plug, Sparkles, ScrollText, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomizeTab } from '@/hooks/settings/use-settings-panel';
import { WorkspaceSideNav } from '@/components/features/workspace-side-nav';

export function CustomizeSubNav({
  tab,
  onTab,
}: {
  tab: CustomizeTab;
  onTab: (t: CustomizeTab) => void;
}) {
  const { t } = useTranslation();

  return (
    <WorkspaceSideNav
      title={t('customize.title')}
      activeId={tab}
      onSelect={onTab}
      items={[
        { id: 'rules', label: t('customize.rules'), icon: ScrollText },
        { id: 'skills', label: t('customize.skills'), icon: Sparkles },
        { id: 'mcp', label: t('customize.mcp'), icon: Plug },
      ]}
      footer={
        <div className="mt-auto p-2">
          <button
            type="button"
            disabled
            className="text-muted-foreground flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm opacity-60"
          >
            <Puzzle className="size-4 shrink-0" />
            <span className="flex-1">{t('customize.plugins')}</span>
            <span className="bg-muted rounded-full px-1.5 py-0.5 text-[10px] font-medium">
              {t('customize.soon')}
            </span>
          </button>
        </div>
      }
    />
  );
}
