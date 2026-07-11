import { AutomationsSettingsScreen } from '@/components/features/settings/automations-settings/automations-settings-screen';
import { useWorkspaceCollapsedInset } from '@/components/features/workspace-view-frame';
import { WorkspaceMain } from '@/components/features/workspace-main';
import { startWindowDrag } from '@/lib/window-drag';

export function AutomateWorkspace() {
  const collapsedInset = useWorkspaceCollapsedInset();

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {collapsedInset > 0 ? (
        <div
          data-tauri-drag-region
          className="h-8 shrink-0"
          style={{ paddingLeft: collapsedInset }}
          onMouseDown={startWindowDrag}
        />
      ) : null}
      <WorkspaceMain>
        <AutomationsSettingsScreen />
      </WorkspaceMain>
    </div>
  );
}
