import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  hideWebView,
  isTauri,
  openWebView,
  resizeWebView,
  showWebView,
  type WebViewBounds,
} from '@/lib/tauri-web-view';
import { PANEL_TAB_MENU_CLOSED_EVENT } from '@/components/assistant-ui/right-panel/panel-events';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useRightSidebar } from '@/components/ui/sidebar';
import {
  hasAskUserSession,
  subscribeAskUserSession,
} from '@/lib/ask-user-question-session';
import type { PanelContentProps } from '../panel-types';

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
}

/** Control panel to open intranet pages in the docked Tauri web-view window. */
export function WebBrowserPanel({ tab, updateState }: PanelContentProps) {
  const { t } = useTranslation();
  const { view } = useSettingsPanel();
  const { open: rightOpen } = useRightSidebar();
  const storedUrl = typeof tab.state?.url === 'string' ? tab.state.url : '';
  const [input, setInput] = useState(storedUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const askOpen = useSyncExternalStore(
    subscribeAskUserSession,
    hasAskUserSession,
    () => false,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const tabId = tab.id;

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
    const bounds = measureBounds();
    if (!bounds) return;
    const shown = await showWebView(tabId, bounds);
    if (!shown) {
      await openWebView(tabId, storedUrl, bounds);
    }
  }, [askOpen, rightOpen, tabId, storedUrl, measureBounds, view]);

  const handleOpen = useCallback(async () => {
    const url = input.trim();
    if (!url) {
      setError(t('web.enterUrl'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await openWebView(tabId, url, measureBounds() ?? undefined);
      updateState({ url, title: titleFromUrl(url) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [input, measureBounds, tabId, updateState, t]);

  useEffect(() => {
    setInput(storedUrl);
  }, [storedUrl]);

  useEffect(() => {
    if (!isTauri() || !askOpen) return;
    void hideWebView();
    return subscribeAskUserSession(() => {
      if (hasAskUserSession()) void hideWebView();
    });
  }, [askOpen]);

  useEffect(() => {
    if (!isTauri() || askOpen || !storedUrl || view !== 'chat' || !rightOpen) {
      if (!rightOpen && isTauri()) void hideWebView(tabId);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      void revealWebView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [askOpen, rightOpen, tabId, storedUrl, revealWebView, view]);

  useEffect(() => {
    if (!isTauri() || view === 'chat') return;
    void hideWebView(tabId);
  }, [view, tabId]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !isTauri()) return;

    const resizeObserver = new ResizeObserver(() => {
      void syncBounds();
    });
    resizeObserver.observe(node);
    window.addEventListener('resize', syncBounds);
    const onMenuClosed = () => {
      if (storedUrl && view === 'chat' && !askOpen && rightOpen) void revealWebView();
    };
    window.addEventListener(PANEL_TAB_MENU_CLOSED_EVENT, onMenuClosed);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener(PANEL_TAB_MENU_CLOSED_EVENT, onMenuClosed);
    };
  }, [askOpen, revealWebView, rightOpen, syncBounds, storedUrl, view]);

  useEffect(() => {
    if (!isTauri()) return;
    const container = document.querySelector(
      '[data-slot="sidebar"][data-side="right"] [data-slot="sidebar-container"]',
    );
    if (!container) return;

    let raf = 0;
    const onLayoutChange = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (!rightOpen) {
          void hideWebView(tabId);
          return;
        }
        if (storedUrl && view === 'chat' && !askOpen) void syncBounds();
      });
    };

    const onTransitionEnd = (event: Event) => {
      if (event.target !== container) return;
      onLayoutChange();
    };

    container.addEventListener('transitionend', onTransitionEnd);
    window.addEventListener('resize', onLayoutChange);
    return () => {
      container.removeEventListener('transitionend', onTransitionEnd);
      window.removeEventListener('resize', onLayoutChange);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [askOpen, rightOpen, storedUrl, syncBounds, tabId, view]);

  useEffect(() => {
    if (view !== 'chat' || askOpen || !rightOpen) return;
    const frame = window.requestAnimationFrame(() => {
      void syncBounds();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [askOpen, rightOpen, view, syncBounds]);

  useEffect(() => {
    return () => {
      void hideWebView(tabId);
    };
  }, [tabId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex shrink-0 gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleOpen();
          }}
          placeholder={t('web.urlPlaceholder')}
          className="h-8 text-xs"
          disabled={loading}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={loading || !isTauri()}
          onClick={() => void handleOpen()}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : t('web.open')}
        </Button>
      </div>

      {error && <p className="text-destructive text-xs whitespace-pre-wrap">{error}</p>}
      {!isTauri() ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed">
          {t('web.requiresDesktopOpen')}
        </p>
      ) : null}
      <div
        className="border-border bg-muted/20 relative min-h-0 flex-1 overflow-hidden rounded-lg border"
        aria-label={t('panels.web.label')}
      >
        <div
          ref={viewportRef}
          className="bg-background absolute inset-1 overflow-hidden rounded-md"
        />
        {!storedUrl && (
          <div className="text-muted-foreground pointer-events-none absolute inset-1 flex items-center justify-center px-4 text-center text-xs">
            {t('web.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
