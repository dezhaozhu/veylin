import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { startWindowDrag } from '@/lib/window-drag';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border mb-6 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div
        className="min-w-0"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
      >
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0" data-no-window-drag>{action}</div>}
    </div>
  );
}

export function PageSearchBar({
  value,
  onChange,
  placeholder,
  filter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  filter?: ReactNode;
}) {
  return (
    <div className="mb-6 flex gap-2">
      <div className="relative min-w-0 flex-1">
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'Search…'}
          className="border-input bg-background h-10 w-full rounded-lg border pr-3 pl-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>
      {filter}
    </div>
  );
}

export function SectionHeading({
  title,
  count,
  trailing,
}: {
  title: string;
  count?: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {count != null && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
            {count}
          </span>
        )}
      </div>
      {trailing}
    </div>
  );
}

export function PrimaryActionButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button type="button" className="rounded-lg px-4" onClick={onClick}>
      {children}
    </Button>
  );
}
