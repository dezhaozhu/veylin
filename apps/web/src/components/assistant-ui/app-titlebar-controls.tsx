import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useWorkspaceNavigation } from '@/hooks/use-workspace-navigation';
import { startWindowDrag } from '@/lib/window-drag';
import { titlebarLeadingInset, titlebarOverlayWidth } from '@/lib/titlebar-layout';

/**
 * Desktop titlebar chrome for the left thread-list rail.
 * When collapsed, keeps a global sidebar trigger so every workspace can reopen the rail.
 */
export function AppTitlebarControls() {
  const { t } = useTranslation();
  const { canGoBack, canGoForward, goBack, goForward } = useWorkspaceNavigation();
  const { open: sidebarOpen, width: sidebarWidth } = useSidebar();

  if (!sidebarOpen) {
    return (
      <div
        className="pointer-events-none fixed left-0 top-0 z-50 flex h-8 items-center bg-transparent"
        style={{ paddingLeft: titlebarLeadingInset(false) }}
      >
        <SidebarTrigger className="pointer-events-auto size-7" />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-50 flex h-8 items-center gap-0.5 bg-transparent pr-2"
      style={{
        width: titlebarOverlayWidth(true, sidebarWidth),
        paddingLeft: titlebarLeadingInset(true),
      }}
    >
      <SidebarTrigger className="pointer-events-auto size-7" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="pointer-events-auto size-7"
        disabled={!canGoBack}
        onClick={goBack}
        aria-label={t('header.back')}
      >
        <ArrowLeft className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="pointer-events-auto size-7"
        disabled={!canGoForward}
        onClick={goForward}
        aria-label={t('header.forward')}
      >
        <ArrowRight className="size-3.5" />
      </Button>
      <div
        data-tauri-drag-region
        className="pointer-events-auto min-w-0 flex-1 self-stretch"
        onMouseDown={startWindowDrag}
      />
    </div>
  );
}
