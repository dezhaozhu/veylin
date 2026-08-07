import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { WindowCaptionControls } from '@/components/assistant-ui/window-caption-controls';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { titlebarLeadingInset } from '@/lib/titlebar-layout';

/**
 * Desktop titlebar chrome outside the left rail.
 * Expanded: collapse lives in SidebarTopChrome (right of the brand row).
 * Collapsed: keep a global reopen trigger so every workspace can open the rail.
 * On Win/Linux also hosts frameless caption buttons (macOS uses native traffic lights).
 *
 * Mobile Sheet visibility is `openMobile`, not desktop `open`. Chat owns the
 * inline menu+brand row (`ThreadHeaderToolbar`); other workspaces still use
 * this fixed reopen trigger.
 */
export function AppTitlebarControls() {
  const { open: sidebarOpen, isMobile, openMobile } = useSidebar();
  const { view } = useSettingsPanel();

  // Chat header inlines the menu on mobile — avoid a second fixed trigger.
  const showReopenTrigger = isMobile
    ? !openMobile && view !== 'chat'
    : !sidebarOpen;

  return (
    <>
      {showReopenTrigger ? (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50 flex h-9 items-center bg-transparent"
          style={{ paddingLeft: titlebarLeadingInset(false) }}
        >
          <SidebarTrigger className="pointer-events-auto size-7 text-muted-foreground hover:text-foreground [&_svg]:size-4" />
        </div>
      ) : null}
      <WindowCaptionControls />
    </>
  );
}
