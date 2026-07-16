import { WindowCaptionControls } from '@/components/assistant-ui/window-caption-controls';

/**
 * Desktop titlebar chrome outside the left rail.
 * Left-rail brand / collapse / drag live in SidebarTopChrome (ChatGPT-style).
 * On Win/Linux this hosts frameless caption buttons (macOS uses native traffic lights).
 */
export function AppTitlebarControls() {
  return <WindowCaptionControls />;
}
