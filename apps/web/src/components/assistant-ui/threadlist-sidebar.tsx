import type * as React from 'react';
import { SlidersHorizontal, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { SidebarTopChrome } from '@/components/assistant-ui/sidebar-brand-toggle';
import {
  ThreadList,
  ThreadListNewChatButton,
  ThreadListShell,
} from '@/components/assistant-ui/thread-list';
import { SidebarUserMenu } from '@/components/assistant-ui/sidebar-user-menu';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { cn } from '@/lib/utils';

/** Left thread-list rail — collapses to a ChatGPT-style icon column. */
export function ThreadListSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();
  const { view, openCustomize, openAutomate, closeWorkspace } = useSettingsPanel();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarTopChrome />
      <ThreadListShell>
        <SidebarHeader className="aui-sidebar-header border-b p-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:border-b-0">
          <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem>
              <ThreadListNewChatButton />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('sidebar.customize')}
                onClick={() => openCustomize('rules')}
                isActive={view === 'customize'}
                className={cn(view === 'customize' && 'font-medium')}
              >
                <SlidersHorizontal />
                <span>{t('sidebar.customize')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('sidebar.automate')}
                onClick={() => openAutomate()}
                isActive={view === 'automate'}
                className={cn(view === 'automate' && 'font-medium')}
              >
                <Zap />
                <span>{t('sidebar.automate')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent
          className="aui-sidebar-content px-2 group-data-[collapsible=icon]:hidden"
          onClick={view !== 'chat' ? closeWorkspace : undefined}
        >
          <ThreadList />
        </SidebarContent>
        <SidebarFooter className="mt-auto p-2 group-data-[collapsible=icon]:items-center">
          <SidebarUserMenu />
        </SidebarFooter>
      </ThreadListShell>
    </Sidebar>
  );
}
