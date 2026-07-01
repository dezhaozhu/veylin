import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useWorkspaceNavigation } from '@/hooks/use-workspace-navigation';
import { startWindowDrag } from '@/lib/window-drag';

/**
 * Desktop titlebar chrome (sidebar toggle, back/forward, drag region).
 * Lives outside the collapsible Sidebar panel so the toggle stays clickable
 * when the left rail is off-canvas.
 */
export function AppTitlebarControls() {
  const { t } = useTranslation();
  const { canGoBack, canGoForward, goBack, goForward } = useWorkspaceNavigation();

  return (
    <div className="pointer-events-none fixed left-0 top-0 z-50 flex h-8 w-[min(560px,calc(100vw-96px))] items-center gap-0.5 bg-transparent pl-[86px] pr-2">
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
