import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Globe, Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  hideWebView,
  isTauri,
  listenWebViewNavigated,
  openWebView,
  readWebView,
  resizeWebView,
  showWebView,
  waitForWebViewBounds,
  webViewGoBack,
  webViewGoForward,
  webViewReload,
  type WebViewBounds,
} from '@/lib/tauri-web-view';
import {
  PANEL_TAB_MENU_CLOSED_EVENT,
  PANEL_WEB_VIEW_RESTORE_EVENT,
} from '@/components/assistant-ui/right-panel/panel-events';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useRightSidebar } from '@/components/ui/sidebar';
import {
  hasAskUserSession,
  subscribeAskUserSession,
} from '@/lib/ask-user-question-session';
import {
  isUrlLikeTitle,
  normalizeWebUrl,
  pushWebRecent,
  readWebRecents,
  titleFromWebUrl,
  updateWebRecentTitle,
  type WebRecent,
} from '@/lib/web-recents';
import { cn } from '@/lib/utils';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';
import type { PanelContentProps } from '../panel-types';

function faviconForUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

function shortUrlLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function WebRecentRow({
  item,
  onSelect,
}: {
  item: WebRecent;
  onSelect: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const favicon = faviconForUrl(item.url);
  const shortUrl = shortUrlLabel(item.url);
  const title = (item.title || titleFromWebUrl(item.url)).trim() || shortUrl;
  const showUrlBeside = title !== shortUrl;

  return (
    <button
      type="button"
      className="hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors"
      onClick={onSelect}
    >
      <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full">
        {favicon && !iconFailed ? (
          <img
            src={favicon}
            alt=""
            className="size-full object-cover"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Globe className="text-muted-foreground size-3.5" />
        )}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="text-foreground max-w-[55%] shrink-0 truncate text-[13px] font-medium leading-5">
          {title}
        </span>
        {showUrlBeside ? (
          <span className="text-muted-foreground min-w-0 truncate text-[12px] leading-5">
            {shortUrl}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Control panel to open intranet pages in the docked Tauri web-view window. */
export function WebBrowserPanel({ tab, updateState }: PanelContentProps) {
  const { t } = useTranslation();
  const { view } = useSettingsPanel();
  const { open: rightOpen, width: rightWidth } = useRightSidebar();
  const storedUrl = typeof tab.state?.url === 'string' ? tab.state.url : '';
  const [input, setInput] = useState(storedUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<WebRecent[]>(() => readWebRecents());
  const [addressFocused, setAddressFocused] = useState(false);
  const askOpen = useSyncExternalStore(
    subscribeAskUserSession,
    hasAskUserSession,
    () => false,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<number | null>(null);
  /** After first focus/select-all, the next click may place the caret. */
  const addressSelectAllPendingRef = useRef(true);
  const tabId = tab.id;
  const hasPage = Boolean(storedUrl);
  const focusAddressAt =
    typeof tab.state?.focusAddressAt === 'number' ? tab.state.focusAddressAt : 0;

  // "+" → 网页 when already open: focus address bar so recents / URL edit is ready.
  useEffect(() => {
    if (!focusAddressAt) return;
    const id = window.setTimeout(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
      addressSelectAllPendingRef.current = false;
      setAddressFocused(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [focusAddressAt]);

  const measureBounds = useCallback((): WebViewBounds | null => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, []);

  /**
   * Sync native webview to the HTML viewport after layout.
   * Prefer ResizeObserver (post-layout) over pointermove — measuring during
   * drag before React commits width causes the page to lag the address chrome.
   */
  const syncBounds = useCallback(async () => {
    if (view !== 'chat' || !rightOpen || askOpen || !storedUrl) return;
    const bounds = measureBounds();
    if (!bounds) return;
    try {
      await resizeWebView(tabId, bounds);
    } catch {
      // The webview may not exist yet; opening a URL will create it with fresh bounds.
    }
  }, [askOpen, measureBounds, rightOpen, tabId, view, storedUrl]);

  const revealWebView = useCallback(async () => {
    if (!isTauri() || askOpen || !storedUrl || !rightOpen || view !== 'chat') return;
    const bounds = await waitForWebViewBounds(measureBounds);
    if (!bounds) return;
    const shown = await showWebView(tabId, bounds);
    if (!shown) {
      await openWebView(tabId, storedUrl, bounds);
    }
    // Correct any initial mismatch after the native layer is shown.
    const next = measureBounds();
    if (next) {
      try {
        await resizeWebView(tabId, next);
      } catch {
        // ignore — webview may have been closed mid-flight
      }
    }
  }, [askOpen, rightOpen, tabId, storedUrl, measureBounds, view]);

  const openUrl = useCallback(
    async (raw: string) => {
      const url = normalizeWebUrl(raw);
      if (!url) {
        setError(t('web.enterUrl'));
        return;
      }
      setLoading(true);
      setError(null);
      setInput(url);
      try {
        const fallbackTitle = titleFromWebUrl(url);
        if (isTauri()) {
          const bounds = await waitForWebViewBounds(measureBounds);
          await openWebView(tabId, url, bounds ?? undefined);
          const next = measureBounds();
          if (next) {
            try {
              await resizeWebView(tabId, next);
            } catch {
              // ignore
            }
          }
        }
        updateState({ url, title: fallbackTitle });
        setRecents(pushWebRecent(url, fallbackTitle));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [measureBounds, tabId, updateState, t],
  );

  const handleOpen = useCallback(() => {
    void openUrl(input);
  }, [input, openUrl]);

  useEffect(() => {
    setInput(storedUrl);
  }, [storedUrl]);

  // Keep address bar / Recents in sync when the page navigates inside the webview.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenWebViewNavigated((payload) => {
      if (disposed || payload.tabId !== tabId) return;
      const url = normalizeWebUrl(payload.url);
      if (!url) return;
      const title =
        payload.title?.trim() && !isUrlLikeTitle(payload.title, url)
          ? payload.title.trim()
          : titleFromWebUrl(url);
      setInput(url);
      updateState({ url, title });
      setRecents(pushWebRecent(url, title));
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tabId, updateState]);

  // Resolve the real document.title after the page loads (Recents shows page name).
  useEffect(() => {
    if (!isTauri() || !storedUrl || askOpen || view !== 'chat' || !rightOpen) return;

    let cancelled = false;
    let resolved = false;
    const delays = [400, 900, 1800, 3200];
    const timers: number[] = [];

    const tryReadTitle = async () => {
      if (cancelled || resolved) return;
      try {
        const page = await readWebView('text', tabId);
        if (cancelled || resolved) return;
        const pageTitle = page.title?.trim() ?? '';
        if (!pageTitle || isUrlLikeTitle(pageTitle, storedUrl)) return;
        resolved = true;
        for (const id of timers) window.clearTimeout(id);
        const pageUrl = normalizeWebUrl(page.url) || storedUrl;
        updateState({ url: pageUrl, title: pageTitle });
        if (pageUrl !== storedUrl) setInput(pageUrl);
        setRecents(updateWebRecentTitle(pageUrl, pageTitle));
      } catch {
        // page may still be loading
      }
    };

    for (const ms of delays) {
      timers.push(window.setTimeout(() => void tryReadTitle(), ms));
    }

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [askOpen, rightOpen, storedUrl, tabId, updateState, view]);

  useEffect(() => {
    if (!isTauri() || !askOpen) return;
    void hideWebView(undefined, { force: true });
    return subscribeAskUserSession(() => {
      if (hasAskUserSession()) void hideWebView(undefined, { force: true });
    });
  }, [askOpen]);

  useEffect(() => {
    if (!isTauri() || askOpen || !storedUrl || view !== 'chat' || !rightOpen) {
      if (!rightOpen && isTauri()) void hideWebView(tabId, { force: true });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      void revealWebView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [askOpen, rightOpen, tabId, storedUrl, revealWebView, view]);

  useEffect(() => {
    if (!isTauri() || view === 'chat') return;
    void hideWebView(tabId, { force: true });
  }, [view, tabId]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !isTauri()) return;

    // Post-layout size/position — stays aligned with the HTML address bar / tab chrome.
    const resizeObserver = new ResizeObserver(() => {
      void syncBounds();
    });
    resizeObserver.observe(node);

    // Position-only moves (e.g. window chrome) and panel close — not drag measure.
    const onLayoutChange = () => {
      if (!rightOpen) {
        void hideWebView(tabId, { force: true });
        return;
      }
      // During column drag, ResizeObserver already syncs after each committed width.
      if (document.body.classList.contains('sidebar-column-resizing')) return;
      if (storedUrl && view === 'chat' && !askOpen) void syncBounds();
    };

    const stopLayout = subscribeLayoutSync(onLayoutChange);

    const onMenuClosed = () => {
      if (storedUrl && view === 'chat' && !askOpen && rightOpen) void revealWebView();
    };
    const onRestore = () => {
      if (storedUrl && view === 'chat' && !askOpen && rightOpen) void revealWebView();
    };
    window.addEventListener(PANEL_TAB_MENU_CLOSED_EVENT, onMenuClosed);
    window.addEventListener(PANEL_WEB_VIEW_RESTORE_EVENT, onRestore);

    return () => {
      resizeObserver.disconnect();
      stopLayout();
      window.removeEventListener(PANEL_TAB_MENU_CLOSED_EVENT, onMenuClosed);
      window.removeEventListener(PANEL_WEB_VIEW_RESTORE_EVENT, onRestore);
    };
  }, [askOpen, revealWebView, rightOpen, syncBounds, storedUrl, tabId, view]);

  // After React commits a new right-panel width, sync native bounds before paint.
  // This keeps the page aligned with the address bar during drag (RO alone is a frame later).
  useLayoutEffect(() => {
    if (!isTauri() || view !== 'chat' || askOpen || !rightOpen || !storedUrl) return;
    void syncBounds();
  }, [askOpen, rightOpen, rightWidth, storedUrl, syncBounds, view]);

  useEffect(() => {
    if (view !== 'chat' || askOpen || !rightOpen) return;
    const frame = window.requestAnimationFrame(() => {
      void syncBounds();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [askOpen, rightOpen, view, syncBounds]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
      void hideWebView(tabId, { force: true });
    };
  }, [tabId]);

  const closeAddressFocus = useCallback(() => {
    setAddressFocused(false);
    addressSelectAllPendingRef.current = true;
    addressInputRef.current?.blur();
  }, []);

  const navDisabled = !isTauri() || !hasPage || loading;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/60 relative z-20 flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          disabled={navDisabled}
          aria-label={t('web.back')}
          onClick={() => void webViewGoBack(tabId)}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          disabled={navDisabled}
          aria-label={t('web.forward')}
          onClick={() => void webViewGoForward(tabId)}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          disabled={navDisabled}
          aria-label={t('web.reload')}
          onClick={() => void webViewReload(tabId)}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCw className="size-3.5" />
          )}
        </Button>
        <div className="relative min-w-0 flex-1">
          <Input
            ref={addressInputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onMouseDown={(e) => {
              // First click focuses + selects all; second click places caret.
              if (document.activeElement === e.currentTarget) return;
              e.preventDefault();
              const el = e.currentTarget;
              el.focus();
              el.select();
              addressSelectAllPendingRef.current = false;
            }}
            onFocus={() => {
              if (blurTimerRef.current != null) {
                window.clearTimeout(blurTimerRef.current);
                blurTimerRef.current = null;
              }
              setAddressFocused(true);
              if (addressSelectAllPendingRef.current) {
                const el = addressInputRef.current;
                if (el) {
                  requestAnimationFrame(() => el.select());
                }
                addressSelectAllPendingRef.current = false;
              }
            }}
            onBlur={() => {
              blurTimerRef.current = window.setTimeout(() => {
                setAddressFocused(false);
                addressSelectAllPendingRef.current = true;
                blurTimerRef.current = null;
              }, 120);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                closeAddressFocus();
                handleOpen();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeAddressFocus();
              }
            }}
            placeholder={t('web.urlPlaceholder')}
            className={cn(
              'h-7 min-w-0 w-full rounded-md border-transparent px-3 text-xs shadow-none transition-colors',
              'bg-muted/50 hover:bg-muted/80',
              'focus-visible:bg-background focus-visible:border-border focus-visible:ring-1 focus-visible:ring-border/60',
              addressFocused && 'bg-background border-border',
            )}
            disabled={loading}
          />
        </div>
      </div>

      {error && (
        <p className="text-destructive shrink-0 px-3 pt-2 text-xs whitespace-pre-wrap">{error}</p>
      )}
      {!isTauri() ? (
        <p className="text-muted-foreground shrink-0 px-3 pt-2 text-xs leading-relaxed">
          {t('web.requiresDesktopOpen')}
        </p>
      ) : null}

      <div
        className="bg-background relative min-h-0 flex-1 overflow-hidden"
        aria-label={t('panels.web.label')}
      >
        <div
          ref={viewportRef}
          className={cn(
            'absolute inset-0 overflow-hidden',
            !hasPage && 'pointer-events-none opacity-0',
          )}
        />
        {!hasPage && (
          <div className="absolute inset-0 overflow-y-auto px-5 py-6">
            <p className="text-muted-foreground mb-2 text-[12px] leading-5">
              {t('web.recents')}
            </p>
            {recents.length === 0 ? (
              <p className="text-muted-foreground/80 text-xs">{t('web.empty')}</p>
            ) : (
              <ul className="flex flex-col">
                {recents.map((item) => (
                  <li key={item.url}>
                    <WebRecentRow item={item} onSelect={() => void openUrl(item.url)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
