import { Plug, Sparkles, ScrollText, Puzzle, Webhook } from 'lucide-react';
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
        { id: 'hooks', label: t('customize.hooks'), icon: Webhook },
        { id: 'mcp', label: t('customize.mcp'), icon: Plug },
        { id: 'plugins', label: t('customize.plugins'), icon: Puzzle },
      ]}
    />
  );
}
