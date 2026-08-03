import { Box, Cable, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { WorkspaceSideNav } from '@/components/features/workspace-side-nav';
import { WorkspaceMain } from '@/components/features/workspace-main';
import { GeneralSettingsScreen } from './general-settings/general-settings-screen';
import { ModelsSettingsScreen } from './models-settings/models-settings-screen';
import { BusinessSourceSettingsScreen } from './business-source/business-source-settings-screen';

export function SettingsWorkspace() {
  const { t } = useTranslation();
  const { settingsTab: tab, setSettingsTab: setTab } = useSettingsPanel();

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1">
      <WorkspaceSideNav
        title={t('settings.navTitle')}
        activeId={tab}
        onSelect={setTab}
        items={[
          { id: 'general', label: t('settings.general.nav'), icon: Settings2 },
          { id: 'models', label: t('settings.models.nav'), icon: Box },
          { id: 'business', label: t('settings.business.nav'), icon: Cable },
        ]}
      />
      <WorkspaceMain>
        {tab === 'general' ? (
          <GeneralSettingsScreen />
        ) : tab === 'business' ? (
          <BusinessSourceSettingsScreen />
        ) : (
          <ModelsSettingsScreen />
        )}
      </WorkspaceMain>
    </div>
  );
}
