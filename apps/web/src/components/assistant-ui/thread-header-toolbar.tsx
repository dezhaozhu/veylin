import { useTranslation } from 'react-i18next';
import {
  RightSidebarTrigger,
  useRightSidebar,
  useSidebar,
} from '@/components/ui/sidebar';
import { collapsedSidebarTriggerReservePx, titlebarTrailingInset } from '@/lib/titlebar-layout';
import { startWindowDrag } from '@/lib/window-drag';

export function ThreadHeaderToolbar() {
  const { t } = useTranslation();
  const { state, open: sidebarOpen } = useSidebar();
  const { state: rightState } = useRightSidebar();
  const brand = t('header.brand');
  const trailingInset = titlebarTrailingInset();

  return (
    <header
      className="flex h-9 shrink-0 items-center gap-1 bg-background"
      style={{
        paddingLeft: sidebarOpen ? 16 : collapsedSidebarTriggerReservePx(),
        paddingRight: rightState === 'collapsed' ? trailingInset : 8,
      }}
    >
      {!sidebarOpen && (
        <div
          data-tauri-drag-region
          className="min-w-9 flex-1 self-stretch"
          onMouseDown={startWindowDrag}
        />
      )}
      {sidebarOpen && state === 'expanded' && (
        <h1
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
          className="veylin-brand-type text-foreground min-w-0 flex-1 truncate py-1 pr-3 text-[17px] leading-none"
          title={brand}
        >
          {brand}
        </h1>
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
