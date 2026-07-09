import { createContext, useContext, type ReactNode } from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { collapsedSidebarTriggerReservePx } from '@/lib/titlebar-layout';
import { WorkspacePanelDragOverlay } from '@/components/features/workspace-panel-drag-overlay';

const WorkspaceCollapsedInsetContext = createContext(0);

/** Left inset for workspace sub-nav titles when the thread list rail is collapsed. */
export function useWorkspaceCollapsedInset(): number {
  return useContext(WorkspaceCollapsedInsetContext);
}

/** Shell for settings / customize / automate — no full-height left gutter when the rail collapses. */
export function WorkspaceViewFrame({ children }: { children: ReactNode }) {
  const { open: sidebarOpen } = useSidebar();
  const collapsedInset = sidebarOpen ? 0 : collapsedSidebarTriggerReservePx();

  return (
    <WorkspaceCollapsedInsetContext.Provider value={collapsedInset}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanelDragOverlay />
        {children}
      </div>
    </WorkspaceCollapsedInsetContext.Provider>
  );
}
