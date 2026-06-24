import type { FC, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const SettingsSwitch: FC<{
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  className?: string;
}> = ({ checked, onChange, label, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
      checked ? 'bg-emerald-500' : 'bg-muted-foreground/30',
      className,
    )}
    onClick={() => onChange(!checked)}
  >
    <span
      className={cn(
        'bg-background absolute top-0.5 size-4 rounded-full shadow-sm transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0.5',
      )}
    />
  </button>
);

export function SettingsSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {count != null && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {count}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
