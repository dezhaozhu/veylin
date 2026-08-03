import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { startWindowDrag } from '@/lib/window-drag';
import { useWorkspaceCollapsedInset } from '@/components/features/workspace-view-frame';

export type WorkspaceSideNavItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  trailing?: React.ReactNode;
};

export function WorkspaceSideNav<T extends string>({
  title,
  items,
  activeId,
  onSelect,
  footer,
}: {
  title: string;
  items: WorkspaceSideNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  footer?: React.ReactNode;
}) {
  const collapsedInset = useWorkspaceCollapsedInset();

  return (
    <aside className="border-border bg-muted/20 flex w-52 shrink-0 flex-col border-r">
      <div
        data-tauri-drag-region
        className="border-border border-b px-4 py-3"
        style={collapsedInset > 0 ? { paddingLeft: collapsedInset } : undefined}
        onMouseDown={startWindowDrag}
      >
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {title}
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map(({ id, label, icon: Icon, disabled, trailing }) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onSelect(id)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              disabled && 'opacity-60',
              activeId === id
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0 opacity-80" />
            <span className="flex-1">{label}</span>
            {trailing}
          </button>
        ))}
      </nav>
      {footer}
    </aside>
  );
}
