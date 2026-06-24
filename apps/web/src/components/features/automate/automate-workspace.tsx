import { AutomationsSettingsScreen } from '@/components/features/settings/automations-settings/automations-settings-screen';

export function AutomateWorkspace() {
  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <AutomationsSettingsScreen />
      </main>
    </div>
  );
}
