import { PanelBottom, PanelTop, Plus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from 'react';
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
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import {
  collapsedSidebarTriggerReservePx,
  isRightPanelNearlyMaximized,
  panelTabBarPaddingLeft,
  titlebarTrailingInset,
} from '@/lib/titlebar-layout';
import { cn } from '@/lib/utils';
import { startWindowDrag } from '@/lib/window-drag';
import { getAvailablePanelKinds, getPanelKindDef } from './panel-registry';
import { PANEL_TAB_MENU_CLOSED_EVENT } from './panel-events';
import type { PanelKind, PanelTab } from './panel-types';

const MENU_WIDTH = 220;
const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

interface PanelTabBarProps {
  tabs: PanelTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: (kind: PanelKind) => void | Promise<void>;
  /**
   * primary = 右栏顶部那条,兼着窗口标题栏职责(window-drag、右栏开关、「+」)。
   * secondary = 分屏下 pane 的那条,不在标题栏区域 —— 没有这些 chrome,新建
   * 页签只发生在上 pane,免掉「新页签去哪」的歧义。
   */
  variant?: 'primary' | 'secondary';
  /** 页签能不能移去另一个 pane(上 pane 只剩一个页签时移走会掏空它 → 不能)。 */
  canMoveTabs?: boolean;
  onMoveTab?: (id: string, pane: 'top' | 'bottom') => void;
}

/** Browser-style tab strip + "+" menu (reference: pill active tab, icon + label). */
export const PanelTabBar: FC<PanelTabBarProps> = ({
  tabs,
  activeId,
  onActivate,
  onClose,
  onOpen,
  variant = 'primary',
  canMoveTabs = false,
  onMoveTab,
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
  const menuWasOpen = useRef(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const openingNativeRef = useRef(false);
  // Keep the Menu resource alive while the OS popup is visible (popup() returns immediately).
  const nativeMenuRef = useRef<Awaited<ReturnType<typeof import('@tauri-apps/api/menu').Menu.new>> | null>(
    null,
  );

  const close = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useOverlayDismiss(close);

  // HTML menu (browser, or Tauri fallback): hide docked webview while open.
  useEffect(() => {
    if (!isTauri()) return;
    if (menuOpen) {
      void hideWebView(undefined, { force: true });
    } else if (menuWasOpen.current) {
      window.dispatchEvent(new CustomEvent(PANEL_TAB_MENU_CLOSED_EVENT));
    }
    menuWasOpen.current = menuOpen;
  }, [menuOpen]);

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
    const next = { top: rect.bottom + 6, right };
    setMenuPos((prev) =>
      prev && prev.top === next.top && prev.right === next.right ? prev : next,
    );
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

  /**
   * Desktop: OS context menu paints above the docked native webview.
   * On failure, fall back to the HTML portal so "+" is never a no-op.
   */
  const openNativePlusMenu = useCallback(async () => {
    if (openingNativeRef.current) return;
    openingNativeRef.current = true;
    try {
      const el = addBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Native menus are content-sized (not MENU_WIDTH). Anchor top-left under
      // the "+" — subtracting MENU_WIDTH left the narrow OS menu far to the left.
      const x = Math.max(8, rect.left);
      const y = rect.bottom;

      const { Menu } = await import('@tauri-apps/api/menu');
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');
      const menu = await Menu.new({
        items: getAvailablePanelKinds().map((def) => ({
          id: def.kind,
          text: t(def.label),
          action: () => {
            onOpenRef.current(def.kind as PanelKind);
          },
        })),
      });
      nativeMenuRef.current = menu;
      // popup() returns as soon as the menu is shown — do not latch menuOpen,
      // or the "+" stays visually selected after the OS menu dismisses.
      await menu.popup(new LogicalPosition(x, y));
    } catch (err) {
      console.error('[panel-tab-bar] native Menu.popup failed; using HTML menu', err);
      setMenuOpen(true);
    } finally {
      openingNativeRef.current = false;
    }
  }, [t]);

  const htmlMenu =
    menuOpen && menuPos
      ? createPortal(
          <>
            <DismissibleBackdrop
              ariaLabel={t('panelTab.closeMenu')}
              onClose={close}
              className="fixed inset-0 z-[300] cursor-default bg-transparent"
            />
            <div
              data-no-window-drag
              className="fixed z-[301]"
              style={{ top: menuPos.top, right: menuPos.right, ...NO_DRAG_STYLE }}
              onClick={(e) => e.stopPropagation()}
            >
              <ComposerMenuPanel className="w-[220px] p-1 shadow-lg">
                {getAvailablePanelKinds().map((def) => (
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
        style={
          variant === 'primary'
            ? { paddingLeft: tabBarPaddingLeft, paddingRight: tabBarPaddingRight }
            : { paddingLeft: 8, paddingRight: 8 }
        }
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
                {canMoveTabs && onMoveTab ? (
                  <button
                    type="button"
                    aria-label={t(variant === 'primary' ? 'panelTab.moveDown' : 'panelTab.moveUp', {
                      title: t(tab.title),
                    })}
                    title={t(variant === 'primary' ? 'panelTab.moveDown' : 'panelTab.moveUp')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveTab(tab.id, variant === 'primary' ? 'bottom' : 'top');
                    }}
                    className={cn(
                      'panel-tab-move flex size-5 shrink-0 items-center justify-center rounded-md transition-opacity duration-150',
                      'opacity-0 group-hover/tab:opacity-70',
                      'hover:bg-foreground/10 hover:opacity-100',
                    )}
                  >
                    {variant === 'primary' ? (
                      <PanelBottom className="size-3" />
                    ) : (
                      <PanelTop className="size-3" />
                    )}
                  </button>
                ) : null}
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
          {/*
            JS-only drag (no data-tauri-drag-region): CSS app-region is geometric
            and can steal clicks from neighboring "+" / caption controls.
            secondary 那条不在标题栏区域,拖它不该拖动窗口。
          */}
          <div
            className="min-w-8 flex-1 self-stretch"
            {...(variant === 'primary' ? { onMouseDown: startWindowDrag } : {})}
          />
        </div>

        {variant === 'secondary' ? null : (
        <button
          ref={addBtnRef}
          type="button"
          data-no-window-drag
          style={NO_DRAG_STYLE}
          aria-label={t('panelTab.new')}
          aria-expanded={menuOpen}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (isTauri()) {
              void openNativePlusMenu();
              return;
            }
            setMenuOpen((o) => !o);
          }}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground ml-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors',
            menuOpen && 'bg-muted text-foreground border-border',
          )}
        >
          <Plus className="size-3.5" />
        </button>
        )}
        {variant === 'primary' ? (
          <RightSidebarTrigger data-no-window-drag className="ml-1 size-7" style={NO_DRAG_STYLE} />
        ) : null}
      </div>
      {htmlMenu}
    </>
  );
};
