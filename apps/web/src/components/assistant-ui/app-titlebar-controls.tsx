import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { WindowCaptionControls } from '@/components/assistant-ui/window-caption-controls';
import { titlebarLeadingInset } from '@/lib/titlebar-layout';

/**
 * Desktop titlebar chrome outside the left rail.
 * Expanded: collapse lives in SidebarTopChrome (right of the brand row).
 * Collapsed: keep a global reopen trigger so every workspace can open the rail.
 * On Win/Linux also hosts frameless caption buttons (macOS uses native traffic lights).
 */
export function AppTitlebarControls() {
  const { open: sidebarOpen } = useSidebar();

  return (
    <>
      {!sidebarOpen ? (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50 flex h-8 items-center bg-transparent"
          style={{ paddingLeft: titlebarLeadingInset(false) }}
        >
          <SidebarTrigger className="pointer-events-auto size-7" />
        </div>
      ) : null}
      <WindowCaptionControls />
    </>
  );
}
