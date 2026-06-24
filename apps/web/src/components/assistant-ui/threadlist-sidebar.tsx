import type * as React from 'react';
import { Bot, SlidersHorizontal } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { ThreadList } from '@/components/assistant-ui/thread-list';
import { SidebarUserMenu } from '@/components/assistant-ui/sidebar-user-menu';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { cn } from '@/lib/utils';

/** Official assistant-ui default layout: left thread list sidebar. */
export function ThreadListSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { view, openCustomize, openAutomate, closeWorkspace } = useSettingsPanel();

  return (
    <Sidebar {...props}>
      <SidebarHeader className="aui-sidebar-header mb-2 border-b">
        <div className="aui-sidebar-header-content flex flex-col gap-1 px-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => openCustomize('skills')}
                className={cn(view === 'customize' && 'bg-accent font-medium')}
              >
                <SlidersHorizontal className="size-4" />
                <span>Customize</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => openAutomate()}
                className={cn(view === 'automate' && 'bg-accent font-medium')}
              >
                <Bot className="size-4" />
                <span>Automate</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>
      <SidebarContent className="aui-sidebar-content px-2" onClick={view !== 'chat' ? closeWorkspace : undefined}>
        <ThreadList />
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarUserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
