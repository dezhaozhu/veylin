import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import { recoverDesktopInteraction } from '@/lib/use-desktop-interaction-guard';
import { stopActiveChatKeepalive } from '@/lib/chat-stop';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Cmd+R / Ctrl+R reload — Tauri does not wire this by default. */
export function installDesktopReloadShortcut(): void {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.DEV && !isTauri()) return;

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key !== 'r' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) {
      return;
    }
    if (isEditableTarget(event.target)) return;

    event.preventDefault();
    // Abort before reload — pagehide/beforeunload alone is flaky in some WebViews.
    stopActiveChatKeepalive();
    if (isTauri()) void hideWebView(undefined, { force: true });
    window.location.reload();
  });
}

/** Cmd/Ctrl+Shift+. — reset stuck overlays and native web-views without restarting. */
export function installDesktopRecoveryShortcut(): void {
  if (typeof window === 'undefined') return;
  if (!isTauri()) return;

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key !== '.' || (!event.metaKey && !event.ctrlKey) || event.altKey || !event.shiftKey) {
      return;
    }
    if (isEditableTarget(event.target)) return;

    event.preventDefault();
    recoverDesktopInteraction();
  });
}
