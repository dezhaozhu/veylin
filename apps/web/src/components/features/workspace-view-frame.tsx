import { createContext, useContext, type ReactNode } from 'react';
import { WorkspacePanelDragOverlay } from '@/components/features/workspace-panel-drag-overlay';

const WorkspaceCollapsedInsetContext = createContext(0);

/** Left inset for workspace sub-nav titles (icon rail already owns layout space). */
export function useWorkspaceCollapsedInset(): number {
  return useContext(WorkspaceCollapsedInsetContext);
}

/** Shell for settings / customize / automate. */
export function WorkspaceViewFrame({ children }: { children: ReactNode }) {
  return (
    <WorkspaceCollapsedInsetContext.Provider value={0}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanelDragOverlay />
        {children}
      </div>
    </WorkspaceCollapsedInsetContext.Provider>
  );
}
