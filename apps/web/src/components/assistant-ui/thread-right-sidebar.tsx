import type * as React from 'react';
import { RightPanel } from '@/components/assistant-ui/right-panel/right-panel';
import { RightSidebar } from '@/components/ui/sidebar';

/** Right panel — offcanvas slide-in hosting a unified multi-tab content area. */
export function ThreadRightSidebar({
  ...props
}: React.ComponentProps<typeof RightSidebar>) {
  return (
    <RightSidebar
      collapsible="offcanvas"
      className="[&_[data-slot=sidebar-container]]:overflow-hidden [&_[data-slot=sidebar-inner]]:overflow-hidden [&_[data-slot=sidebar-inner]]:border-l [&_[data-slot=sidebar-inner]]:shadow-none"
      {...props}
    >
      <div
        data-slot="sidebar-content"
        className="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      >
        <RightPanel />
      </div>
    </RightSidebar>
  );
}
