import { useEffect } from 'react';
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
  if (isTauri()) void hideWebView();
}

export function useDesktopInteractionGuard(options: {
  rightSidebarOpen: boolean;
  workspaceView: WorkspaceView;
  hasVisibleWebTab: boolean;
}): void {
  const { rightSidebarOpen, workspaceView, hasVisibleWebTab } = options;

  useEffect(() => {
    if (!isTauri()) return;
    if (!rightSidebarOpen || workspaceView !== 'chat' || !hasVisibleWebTab) {
      void hideWebView();
    }
  }, [rightSidebarOpen, workspaceView, hasVisibleWebTab]);

  useEffect(() => {
    if (!isTauri()) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void hideWebView();
    };
    const onBlur = () => {
      void hideWebView();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
