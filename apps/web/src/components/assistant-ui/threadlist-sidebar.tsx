import type * as React from 'react';
import { Bot, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const { view, openCustomize, openAutomate, closeWorkspace } = useSettingsPanel();

  return (
    <Sidebar {...props}>
      {/* Reserve space for AppTitlebarControls (fixed, outside this panel). */}
      <div className="h-8 shrink-0" aria-hidden />
      <SidebarHeader className="aui-sidebar-header mb-2 border-b p-0">
        <div className="aui-sidebar-header-content flex flex-col gap-1 px-2 pb-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => openCustomize('rules')}
                className={cn(view === 'customize' && 'bg-accent font-medium')}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <SlidersHorizontal className="size-4" />
                </span>
                <span>{t('sidebar.customize')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => openAutomate()}
                className={cn(view === 'automate' && 'bg-accent font-medium')}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Bot className="size-4" />
                </span>
                <span>{t('sidebar.automate')}</span>
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
