import type * as React from 'react';
import { RightPanel } from '@/components/assistant-ui/right-panel/right-panel';
import { RightSidebar, SidebarContent } from '@/components/ui/sidebar';

/** Right panel — offcanvas slide-in hosting a unified multi-tab content area. */
export function ThreadRightSidebar({
  ...props
}: React.ComponentProps<typeof RightSidebar>) {
  return (
    <RightSidebar
      collapsible="offcanvas"
      className="[&_[data-slot=sidebar-inner]]:shadow-none"
      {...props}
    >
      <SidebarContent className="min-h-0 flex-1 overflow-hidden p-0">
        <RightPanel />
      </SidebarContent>
    </RightSidebar>
  );
}
