import type * as React from 'react';
import { useAuiState } from '@assistant-ui/react';
import { ArrowLeft, ArrowRight, Bot, SlidersHorizontal } from 'lucide-react';
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
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { ThreadList } from '@/components/assistant-ui/thread-list';
import { SidebarUserMenu } from '@/components/assistant-ui/sidebar-user-menu';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useThreadNavigationHistory } from '@/lib/use-thread-navigation-history';
import { cn } from '@/lib/utils';
import { startWindowDrag } from '@/lib/window-drag';

function ThreadListTitlebarControls() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const title = useAuiState((s) => s.threadListItem.title);
  const { canGoBack, canGoForward, goBack, goForward } =
    useThreadNavigationHistory(threadId);
  const displayTitle = title?.trim() || t('header.newChat');

  return (
    <>
      <div className="fixed left-0 top-0 z-50 flex h-8 w-[min(560px,calc(100vw-96px))] items-center gap-0.5 bg-transparent pl-[86px] pr-2">
        <SidebarTrigger className="size-7" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!canGoBack}
          onClick={goBack}
          aria-label={t('header.back')}
          title={t('header.back')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!canGoForward}
          onClick={goForward}
          aria-label={t('header.forward')}
          title={t('header.forward')}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        {state === 'collapsed' && (
          <h1
            data-tauri-drag-region
            onMouseDown={startWindowDrag}
            className={cn(
              'ml-1 min-w-0 flex-1 truncate text-xs font-medium',
              !title?.trim() && 'text-muted-foreground',
            )}
            title={displayTitle}
          >
            {displayTitle}
          </h1>
        )}
        {state === 'expanded' && (
          <div
            data-tauri-drag-region
            className="min-w-0 flex-1 self-stretch"
            onMouseDown={startWindowDrag}
          />
        )}
      </div>
      <div className="h-8 shrink-0" />
    </>
  );
}

/** Official assistant-ui default layout: left thread list sidebar. */
export function ThreadListSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();
  const { view, openCustomize, openAutomate, closeWorkspace } = useSettingsPanel();

  return (
    <Sidebar {...props}>
      <ThreadListTitlebarControls />
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
