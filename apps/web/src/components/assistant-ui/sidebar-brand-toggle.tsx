import { PanelLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { titlebarLeadingInset } from '@/lib/titlebar-layout';
import { startWindowDrag } from '@/lib/window-drag';
import { cn } from '@/lib/utils';

function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/splash-logo.png"
      alt=""
      aria-hidden
      className={cn('size-4 object-contain invert dark:invert-0', className)}
    />
  );
}

/**
 * ChatGPT-style sidebar top chrome:
 * - collapsed: centered logo (hover → expand icon), click opens
 * - expanded: logo left + drag + collapse icon right (no full-width “关闭侧边栏” row)
 */
export function SidebarTopChrome() {
  const { t } = useTranslation();
  const { open, toggleSidebar } = useSidebar();

  if (!open) {
    return (
      <div className="flex h-8 shrink-0 items-center justify-center px-2">
        <button
          type="button"
          onClick={toggleSidebar}
          title={t('sidebar.openSidebar')}
          aria-label={t('sidebar.openSidebar')}
          className={cn(
            'group/brand text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'relative flex size-8 items-center justify-center rounded-md',
          )}
        >
          <BrandMark className="transition-opacity duration-150 group-hover/brand:opacity-0" />
          <PanelLeftIcon className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover/brand:opacity-100" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 pr-2"
      style={{ paddingLeft: titlebarLeadingInset(true) }}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        <BrandMark />
      </span>
      <div
        data-tauri-drag-region
        className="min-w-0 flex-1 self-stretch"
        onMouseDown={startWindowDrag}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        title={t('sidebar.closeSidebar')}
        aria-label={t('sidebar.closeSidebar')}
        onClick={toggleSidebar}
      >
        <PanelLeftIcon className="size-4" />
      </Button>
    </div>
  );
}
