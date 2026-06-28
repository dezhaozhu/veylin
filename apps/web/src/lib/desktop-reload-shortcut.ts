import { hideWebView, isTauri } from '@/lib/tauri-web-view';

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
    if (isTauri()) void hideWebView();
    window.location.reload();
  });
}
