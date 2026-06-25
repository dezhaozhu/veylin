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

export async function openWebView(url: string, bounds?: WebViewBounds): Promise<void> {
  if (!isTauri()) {
    throw new Error(i18n.t('web.requiresDesktopOpen'));
  }
  await tauriInvoke('open_web_view', { url, bounds });
}

export async function resizeWebView(bounds: WebViewBounds): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('resize_web_view', { bounds });
}

export async function hideWebView(): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke('hide_web_view');
}

export async function readWebView(mode: 'text' | 'html' = 'text'): Promise<PageContent> {
  if (!isTauri()) {
    throw new Error(i18n.t('web.requiresDesktopRead'));
  }
  return tauriInvoke<PageContent>('read_web_view', { mode });
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
