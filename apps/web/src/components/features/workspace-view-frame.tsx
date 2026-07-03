import type { ReactNode } from 'react';
import { WorkspacePanelDragOverlay } from '@/components/features/workspace-panel-drag-overlay';
import { useSidebar } from '@/components/ui/sidebar';
import { collapsedSidebarTriggerReservePx } from '@/lib/titlebar-layout';

/** Shell for settings / customize / automate — clears the global sidebar trigger when collapsed. */
export function WorkspaceViewFrame({ children }: { children: ReactNode }) {
  const { open: sidebarOpen } = useSidebar();
  const triggerReserve = sidebarOpen ? 0 : collapsedSidebarTriggerReservePx();

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      style={{ paddingLeft: triggerReserve }}
    >
      <WorkspacePanelDragOverlay />
      {children}
    </div>
  );
}
