import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ComposerMenuPanel,
  ComposerMenuRow,
} from '@/components/assistant-ui/composer-menu-flyout';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { RightSidebarTrigger, useRightSidebar, useSidebar } from '@/components/ui/sidebar';
import { readChatWorkspaceWidth, rightPanelWidthMax } from '@/lib/chat-panel-ratio';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';
import {
  closePanelMenu,
  isTauri,
  listenPanelMenuClosed,
  listenPanelMenuSelect,
  showPanelMenu,
} from '@/lib/tauri-web-view';
import {
  collapsedSidebarTriggerReservePx,
  isRightPanelNearlyMaximized,
  panelTabBarPaddingLeft,
  titlebarTrailingInset,
} from '@/lib/titlebar-layout';
import { cn } from '@/lib/utils';
import { startWindowDrag } from '@/lib/window-drag';
import { PANEL_KINDS, getPanelKindDef } from './panel-registry';
import type { PanelKind, PanelTab } from './panel-types';

const MENU_WIDTH = 220;
const MENU_ROW_HEIGHT = 36;
const MENU_CHROME = 16;

interface PanelTabBarProps {
  tabs: PanelTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: (kind: PanelKind) => void;
}

/** Browser-style tab strip + "+" menu (reference: pill active tab, icon + label). */
export const PanelTabBar: FC<PanelTabBarProps> = ({
  tabs,
  activeId,
  onActivate,
  onClose,
  onOpen,
}) => {
  const { t } = useTranslation();
  const { open: sidebarOpen } = useSidebar();
  const { open: rightOpen, width: rightWidth } = useRightSidebar();
  const workspaceWidth = readChatWorkspaceWidth();
  const rightMax = rightPanelWidthMax(workspaceWidth);
  const showCollapsedChrome =
    !sidebarOpen &&
    isRightPanelNearlyMaximized(rightOpen, rightWidth, workspaceWidth, rightMax);
  const tabBarPaddingLeft = showCollapsedChrome
    ? collapsedSidebarTriggerReservePx()
    : panelTabBarPaddingLeft();
  const tabBarPaddingRight = titlebarTrailingInset();
  const [menuOpen, setMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const close = useCallback(() => {
    setMenuOpen(false);
    if (isTauri()) void closePanelMenu();
  }, []);

  useOverlayDismiss(close);

  const updateMenuPos = useCallback(() => {
    const el = addBtnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const padding = 8;
    let right = window.innerWidth - rect.right;
    const left = rect.right - MENU_WIDTH;
    if (left < padding) {
      right = window.innerWidth - MENU_WIDTH - padding;
    }
    setMenuPos({ top: rect.bottom + 6, right });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const stopLayout = subscribeLayoutSync(updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      stopLayout();
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [menuOpen, updateMenuPos]);

  // Desktop: native always-on-top menu paints above the docked webview.
  // Page layout stays untouched — same idea as Cursor's floating "+" menu.
  useEffect(() => {
    if (!isTauri() || !menuOpen || !menuPos) return;

    let cancelled = false;
    const items = PANEL_KINDS.map((def) => ({
      kind: def.kind,
      label: t(def.label),
      description: def.description ? t(def.description) : undefined,
    }));
    const height = MENU_CHROME + items.length * MENU_ROW_HEIGHT;
    const viewportX = window.innerWidth - menuPos.right - MENU_WIDTH;
    const viewportY = menuPos.top;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const [factor, outer] = await Promise.all([win.scaleFactor(), win.outerPosition()]);
        const [innerPos, outerSize, innerSize] = await Promise.all([
          win.innerPosition(),
          win.outerSize(),
          win.innerSize(),
        ]);
        const chromeX = (innerPos.x - outer.x) / factor;
        const chromeY = (innerPos.y - outer.y) / factor;
        // Prefer inner→outer delta; fall back if platform reports zeros.
        const offsetX = Number.isFinite(chromeX) ? chromeX : 0;
        const offsetY = Number.isFinite(chromeY)
          ? chromeY
          : Math.max(0, (outerSize.height - innerSize.height) / factor);
        await showPanelMenu({
          x: outer.x / factor + offsetX + viewportX,
          y: outer.y / factor + offsetY + viewportY,
          width: MENU_WIDTH,
          height,
          items,
        });
      } catch {
        if (!cancelled) setMenuOpen(false);
      }
    })();

    let unlistenSelect: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;
    void listenPanelMenuSelect((kind) => {
      if (cancelled) return;
      onOpenRef.current(kind as PanelKind);
      setMenuOpen(false);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenSelect = fn;
    });
    void listenPanelMenuClosed(() => {
      if (!cancelled) setMenuOpen(false);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenClosed = fn;
    });

    return () => {
      cancelled = true;
      unlistenSelect?.();
      unlistenClosed?.();
      void closePanelMenu();
    };
  }, [menuOpen, menuPos, t]);

  // Browser / non-Tauri fallback: HTML portal is fine (no native webview layer).
  const htmlMenu =
    !isTauri() && menuOpen && menuPos
      ? createPortal(
          <>
            <DismissibleBackdrop
              ariaLabel={t('panelTab.closeMenu')}
              onClose={close}
              className="fixed inset-0 z-[300] cursor-default bg-transparent"
            />
            <div
              className="fixed z-[301]"
              style={{ top: menuPos.top, right: menuPos.right }}
              onClick={(e) => e.stopPropagation()}
            >
              <ComposerMenuPanel className="w-[220px] p-1 shadow-lg">
                {PANEL_KINDS.map((def) => (
                  <ComposerMenuRow
                    key={def.kind}
                    icon={def.icon}
                    label={t(def.label)}
                    title={def.description ? t(def.description) : undefined}
                    onClick={() => {
                      onOpen(def.kind);
                      close();
                    }}
                  />
                ))}
              </ComposerMenuPanel>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        className="border-border bg-background flex h-8 shrink-0 items-center border-b"
        style={{ paddingLeft: tabBarPaddingLeft, paddingRight: tabBarPaddingRight }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const active = activeId === tab.id;
            const def = getPanelKindDef(tab.kind);
            return (
              <div
                key={tab.id}
                className={cn(
                  'group/tab flex max-w-[11rem] shrink-0 items-center rounded-lg text-xs transition-colors',
                  active
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => onActivate(tab.id)}
                  className="panel-tab-label flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-2.5 pr-1"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center opacity-70">
                    {def?.icon}
                  </span>
                  <span className="truncate">{t(tab.title)}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('panelTab.close', { title: t(tab.title) })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    'panel-tab-close mr-1 flex size-5 shrink-0 items-center justify-center rounded-md transition-opacity duration-150',
                    'opacity-0 group-hover/tab:opacity-70',
                    'hover:bg-foreground/10 hover:opacity-100',
                  )}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
          <div
            data-tauri-drag-region
            className="min-w-8 flex-1 self-stretch"
            onMouseDown={startWindowDrag}
          />
        </div>

        <button
          ref={addBtnRef}
          type="button"
          aria-label={t('panelTab.new')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground ml-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors',
            menuOpen && 'bg-muted text-foreground border-border',
          )}
        >
          <Plus className="size-3.5" />
        </button>
        <RightSidebarTrigger className="ml-1 size-7" />
      </div>
      {htmlMenu}
    </>
  );
};
