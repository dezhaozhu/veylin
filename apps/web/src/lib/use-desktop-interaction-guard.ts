import { useEffect, useRef } from 'react';
import { PANEL_WEB_VIEW_RESTORE_EVENT } from '@/components/assistant-ui/right-panel/panel-events';
import { dispatchOverlayDismiss } from '@/lib/overlay-dismiss';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import type { WorkspaceView } from '@/lib/workspace-navigation';

function clearSidebarResizeBodyStyles(): void {
  if (typeof document === 'undefined') return;
  document.body.classList.remove('sidebar-column-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

/** Reset native layers, overlays, and leaked body interaction styles. */
export function recoverDesktopInteraction(): void {
  dispatchOverlayDismiss('recovery');
  clearSidebarResizeBodyStyles();
  if (isTauri()) void hideWebView(undefined, { force: true });
}

export function useDesktopInteractionGuard(options: {
  rightSidebarOpen: boolean;
  workspaceView: WorkspaceView;
  hasVisibleWebTab: boolean;
}): void {
  const { rightSidebarOpen, workspaceView, hasVisibleWebTab } = options;
  const hasVisibleWebTabRef = useRef(hasVisibleWebTab);
  hasVisibleWebTabRef.current = hasVisibleWebTab;

  useEffect(() => {
    if (!isTauri()) return;
    if (!rightSidebarOpen || workspaceView !== 'chat' || !hasVisibleWebTab) {
      void hideWebView();
    }
  }, [rightSidebarOpen, workspaceView, hasVisibleWebTab]);

  useEffect(() => {
    if (!isTauri()) return;
    // Hide only when there is no web tab that should stay visible.
    // Child webview focus must not tear down an active panel page; when the
    // document returns to visible, ask the panel to re-show/sync bounds.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (!hasVisibleWebTabRef.current) void hideWebView();
        return;
      }
      if (hasVisibleWebTabRef.current) {
        window.dispatchEvent(new CustomEvent(PANEL_WEB_VIEW_RESTORE_EVENT));
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
