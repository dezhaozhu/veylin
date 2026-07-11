import i18n from '@/i18n';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) {
    throw new Error('Tauri IPC unavailable');
  }
  return invoke<T>(cmd, args);
}

export interface PageContent {
  url: string;
  title: string;
  content: string;
}

export interface WebViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ignore non-forced hideWebView calls until this timestamp (ms since epoch). */
let hideSuppressedUntil = 0;

/**
 * Briefly ignore hideWebView so open/show is not immediately undone by
 * visibility/guard effects when the native child webview steals focus.
 * Pass `ms <= 0` to clear the suppress window (tests / recovery).
 */
export function suppressWebViewHide(ms = 400): void {
  if (ms <= 0) {
    hideSuppressedUntil = 0;
    return;
  }
  hideSuppressedUntil = Math.max(hideSuppressedUntil, Date.now() + ms);
}

export function isWebViewHideSuppressed(): boolean {
  return Date.now() < hideSuppressedUntil;
}

/** Wait until the panel placeholder has a positive layout size (or give up). */
export async function waitForWebViewBounds(
  measure: () => WebViewBounds | null,
  attempts = 8,
): Promise<WebViewBounds | null> {
  for (let i = 0; i < attempts; i++) {
    const bounds = measure();
    if (bounds) return bounds;
    await new Promise<void>((resolve) => {
      const raf = globalThis.requestAnimationFrame;
      if (typeof raf === 'function') {
        raf(() => resolve());
      } else {
        resolve();
      }
    });
  }
  return measure();
}

export async function openWebView(
  tabId: string,
  url: string,
  bounds?: WebViewBounds,
): Promise<void> {
  if (!isTauri()) {
    throw new Error(i18n.t('web.requiresDesktopOpen'));
  }
  suppressWebViewHide();
  await tauriInvoke('open_web_view', { tabId, url, bounds });
}

export async function showWebView(tabId: string, bounds?: WebViewBounds): Promise<boolean> {
  if (!isTauri()) return false;
  suppressWebViewHide();
  return tauriInvoke<boolean>('show_web_view', { tabId, bounds });
}

function boundsKey(bounds: WebViewBounds): string {
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

type PendingResize = {
  bounds: WebViewBounds;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Latest requested bounds per tab — drag can outpace IPC. */
const pendingResizeByTab = new Map<string, PendingResize>();
const resizeInFlight = new Set<string>();
/** Last bounds successfully sent to the native layer. */
const lastSentBoundsByTab = new Map<string, string>();

async function flushResizeWebView(tabId: string): Promise<void> {
  if (resizeInFlight.has(tabId)) return;

  const pending = pendingResizeByTab.get(tabId);
  if (!pending) return;
  pendingResizeByTab.delete(tabId);

  const key = boundsKey(pending.bounds);
  if (lastSentBoundsByTab.get(tabId) === key) {
    pending.resolve();
    if (pendingResizeByTab.has(tabId)) await flushResizeWebView(tabId);
    return;
  }

  resizeInFlight.add(tabId);
  try {
    await tauriInvoke('resize_web_view', { tabId, bounds: pending.bounds });
    lastSentBoundsByTab.set(tabId, key);
    pending.resolve();
  } catch (error) {
    pending.reject(error);
  } finally {
    resizeInFlight.delete(tabId);
    if (pendingResizeByTab.has(tabId)) await flushResizeWebView(tabId);
  }
}

/**
 * Resize the docked native webview.
 * Coalesces rapid updates (sidebar drag): only the latest bounds are applied,
 * so an older IPC reply cannot overwrite a newer size and desync from the HTML chrome.
 */
export async function resizeWebView(tabId: string, bounds: WebViewBounds): Promise<void> {
  if (!isTauri()) return;

  return new Promise<void>((resolve, reject) => {
    const prev = pendingResizeByTab.get(tabId);
    if (prev) prev.resolve();
    pendingResizeByTab.set(tabId, { bounds, resolve, reject });
    void flushResizeWebView(tabId);
  });
}

/** Test helper: clear coalesce / last-sent state between cases. */
export function resetWebViewResizeStateForTests(): void {
  pendingResizeByTab.clear();
  resizeInFlight.clear();
  lastSentBoundsByTab.clear();
}

export async function hideWebView(
  tabId?: string,
  options?: { force?: boolean },
): Promise<void> {
  if (!isTauri()) return;
  if (!options?.force && isWebViewHideSuppressed()) return;
  if (tabId) {
    lastSentBoundsByTab.delete(tabId);
  } else {
    lastSentBoundsByTab.clear();
  }
  await tauriInvoke('hide_web_view', { tabId: tabId ?? null });
}

export async function closeWebView(tabId: string): Promise<void> {
  if (!isTauri()) return;
  lastSentBoundsByTab.delete(tabId);
  pendingResizeByTab.delete(tabId);
  await tauriInvoke('close_web_view', { tabId });
}

export async function webViewGoBack(tabId: string): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('web_view_go_back', { tabId });
}

export async function webViewGoForward(tabId: string): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('web_view_go_forward', { tabId });
}

export async function webViewReload(tabId: string): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('web_view_reload', { tabId });
}

export type WebViewNavigatedPayload = {
  tabId: string;
  url: string;
  title: string;
};

/** Subscribe to in-panel navigations (same-tab links / target=_blank redirected). */
export async function listenWebViewNavigated(
  onNavigated: (payload: WebViewNavigatedPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<WebViewNavigatedPayload>('web-view-navigated', (event) => {
    onNavigated(event.payload);
  });
  return unlisten;
}

export type PanelMenuItem = {
  kind: string;
  label: string;
  description?: string;
};

/** Open a native always-on-top menu above the docked webview (no page resize). */
export async function showPanelMenu(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  items: PanelMenuItem[];
}): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('show_panel_menu', options);
}

export async function closePanelMenu(): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('close_panel_menu');
}

export async function listenPanelMenuSelect(
  onSelect: (kind: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<{ kind: string }>('panel-menu-select', (event) => {
    onSelect(event.payload.kind);
  });
  return unlisten;
}

export async function listenPanelMenuClosed(onClosed: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen('panel-menu-closed', () => {
    onClosed();
  });
  return unlisten;
}

export async function readWebView(
  mode: 'text' | 'html' = 'text',
  tabId?: string,
): Promise<PageContent> {
  if (!isTauri()) {
    throw new Error(i18n.t('web.requiresDesktopRead'));
  }
  return tauriInvoke<PageContent>('read_web_view', { tabId: tabId ?? null, mode });
}

export function truncatePageContent(
  content: string,
  maxChars: number,
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(0, maxChars),
    truncated: true,
  };
}
