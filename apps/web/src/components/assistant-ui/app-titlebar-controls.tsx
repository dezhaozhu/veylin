import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { WindowCaptionControls } from '@/components/assistant-ui/window-caption-controls';
import { startWindowDrag } from '@/lib/window-drag';
import {
  titlebarLeadingInset,
  titlebarOverlayWidth,
} from '@/lib/titlebar-layout';

/**
 * Desktop titlebar chrome for the left thread-list rail.
 * When collapsed, keeps a global sidebar trigger so every workspace can reopen the rail.
 * On Win/Linux, also hosts frameless caption buttons (macOS uses native traffic lights).
 */
export function AppTitlebarControls() {
  const { open: sidebarOpen, width: sidebarWidth } = useSidebar();

  return (
    <>
      {!sidebarOpen ? (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50 flex h-8 items-center bg-transparent"
          style={{ paddingLeft: titlebarLeadingInset(false) }}
        >
          <SidebarTrigger className="pointer-events-auto size-7" />
        </div>
      ) : (
        <div
          className="pointer-events-none fixed left-0 top-0 z-50 flex h-8 items-center gap-0.5 bg-transparent pr-2"
          style={{
            width: titlebarOverlayWidth(true, sidebarWidth),
            paddingLeft: titlebarLeadingInset(true),
          }}
        >
          <SidebarTrigger className="pointer-events-auto size-7" />
          <div
            data-tauri-drag-region
            className="pointer-events-auto min-w-0 flex-1 self-stretch"
            onMouseDown={startWindowDrag}
          />
        </div>
      )}
      <WindowCaptionControls />
    </>
  );
}
