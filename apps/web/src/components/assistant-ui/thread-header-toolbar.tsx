import { useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { RightSidebarTrigger, useRightSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { titlebarTrailingInset } from '@/lib/titlebar-layout';
import { startWindowDrag } from '@/lib/window-drag';

export function ThreadHeaderToolbar() {
  const { t } = useTranslation();
  const { state: rightState } = useRightSidebar();
  const title = useAuiState((s) => s.threadListItem.title);
  const displayTitle = title?.trim() || t('header.newChat');
  const trailingInset = titlebarTrailingInset();

  return (
    <header
      className="flex h-8 shrink-0 items-center gap-0.5 bg-background"
      style={{
        paddingLeft: 8,
        paddingRight: rightState === 'collapsed' ? trailingInset : 8,
      }}
    >
      <h1
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
        className={cn(
          'min-w-0 flex-1 truncate px-1 text-xs font-medium',
          !title?.trim() && 'text-muted-foreground',
        )}
        title={displayTitle}
      >
        {displayTitle}
      </h1>
      {rightState === 'collapsed' && (
        <RightSidebarTrigger
          className="fixed top-0.5 z-50 size-7"
          style={{ right: trailingInset }}
        />
      )}
    </header>
  );
}
