import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { CustomizeSubNav } from './customize-sub-nav';
import { SkillsSettingsScreen } from '@/components/features/settings/skills-settings/skills-settings-screen';
import { RulesSettingsScreen } from '@/components/features/settings/rules-settings/rules-settings-screen';
import { McpSettingsScreen } from '@/components/features/settings/mcp-settings/mcp-settings-screen';

export function CustomizeWorkspace() {
  const { customizeTab, setCustomizeTab } = useSettingsPanel();

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1">
      <CustomizeSubNav tab={customizeTab} onTab={setCustomizeTab} />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {customizeTab === 'skills' && <SkillsSettingsScreen />}
        {customizeTab === 'rules' && <RulesSettingsScreen />}
        {customizeTab === 'mcp' && <McpSettingsScreen />}
      </main>
    </div>
  );
}
