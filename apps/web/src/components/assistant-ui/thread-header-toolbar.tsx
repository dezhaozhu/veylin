import { useTranslation } from 'react-i18next';
import {
  RightSidebarTrigger,
  SidebarTrigger,
  useRightSidebar,
  useSidebar,
} from '@/components/ui/sidebar';
import { collapsedSidebarTriggerReservePx, titlebarTrailingInset } from '@/lib/titlebar-layout';
import { startWindowDrag } from '@/lib/window-drag';

/**
 * Chat column titlebar.
 * Mobile: ChatGPT-style [menu][brand] in-flow (no fixed overlay overlapping the wordmark).
 * Desktop: brand when the left rail is expanded; collapsed rail keeps a drag strip + reserved trigger slot.
 */
export function ThreadHeaderToolbar() {
  const { t } = useTranslation();
  const { state, open: sidebarOpen, isMobile, openMobile } = useSidebar();
  const { state: rightState } = useRightSidebar();
  const brand = t('header.brand');
  const trailingInset = titlebarTrailingInset();

  // Mobile uses Sheet (`openMobile`); desktop uses `sidebarOpen`. Mixing them
  // left the fixed reopen trigger painted over the brand on narrow screens.
  const railOpen = isMobile ? openMobile : sidebarOpen;
  const showInlineMenu = isMobile && !openMobile;
  const showBrand = isMobile || (sidebarOpen && state === 'expanded');
  const paddingLeft = showInlineMenu
    ? 8
    : railOpen
      ? 16
      : collapsedSidebarTriggerReservePx();

  return (
    <header
      className="flex h-9 shrink-0 items-center gap-1 bg-background"
      style={{
        paddingLeft,
        paddingRight: rightState === 'collapsed' ? trailingInset : 8,
      }}
    >
      {showInlineMenu && (
        <SidebarTrigger className="size-7 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-4" />
      )}
      {showBrand ? (
        <h1
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
          className="veylin-brand-type text-foreground min-w-0 flex-1 truncate py-1 pr-3 text-[17px] leading-none"
          title={brand}
        >
          {brand}
        </h1>
      ) : (
        <div
          data-tauri-drag-region
          className="min-w-9 flex-1 self-stretch"
          onMouseDown={startWindowDrag}
        />
      )}
      {rightState === 'collapsed' && (
        <RightSidebarTrigger
          className="fixed top-1 z-50 size-7 text-muted-foreground hover:text-foreground [&_svg]:size-4"
          style={{ right: trailingInset }}
        />
      )}
    </header>
  );
}
