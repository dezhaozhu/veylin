import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { CustomizeSubNav } from './customize-sub-nav';
import { WorkspaceMain } from '@/components/features/workspace-main';
import { SkillsSettingsScreen } from '@/components/features/settings/skills-settings/skills-settings-screen';
import { RulesSettingsScreen } from '@/components/features/settings/rules-settings/rules-settings-screen';
import { McpSettingsScreen } from '@/components/features/settings/mcp-settings/mcp-settings-screen';
import { HooksSettingsScreen } from '@/components/features/settings/hooks-settings/hooks-settings-screen';
import { PluginsSettingsScreen } from '@/components/features/settings/plugins-settings/plugins-settings-screen';

export function CustomizeWorkspace() {
  const { customizeTab, setCustomizeTab } = useSettingsPanel();

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1">
      <CustomizeSubNav tab={customizeTab} onTab={setCustomizeTab} />
      <WorkspaceMain>
        {customizeTab === 'skills' && <SkillsSettingsScreen />}
        {customizeTab === 'rules' && <RulesSettingsScreen />}
        {customizeTab === 'hooks' && <HooksSettingsScreen />}
        {customizeTab === 'mcp' && <McpSettingsScreen />}
        {customizeTab === 'plugins' && <PluginsSettingsScreen />}
      </WorkspaceMain>
    </div>
  );
}
