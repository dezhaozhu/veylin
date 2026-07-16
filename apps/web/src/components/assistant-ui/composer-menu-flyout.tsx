import { ChevronRightIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function ComposerMenuPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'bg-popover text-popover-foreground w-[280px] rounded-lg border p-1.5 shadow-md',
        className,
      )}
    >
      {children}
    </div>
  );
}

export const ComposerMenuFlyoutItem: FC<{
  icon: ReactNode;
  label: string;
  active?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onClick?: () => void;
  children?: ReactNode;
}> = ({ icon, label, active, onOpen, onClose, onClick, children }) => {
  return (
    <div
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        className={cn(
          'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
          active && 'bg-accent',
        )}
        onClick={onClick}
      >
        <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {children != null && (
          <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0 opacity-60" />
        )}
      </button>
      {active && children != null && (
        <div className="absolute top-0 left-full z-50 ml-1">{children}</div>
      )}
    </div>
  );
};

export function ComposerMenuRow({
  icon,
  label,
  pressed,
  title,
  hint,
  onClick,
  onMouseEnter,
}: {
  icon: ReactNode;
  label: string;
  pressed?: boolean;
  title?: string;
  /** Trailing muted hint (e.g. “已打开”). */
  hint?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
        pressed && 'bg-accent',
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {hint ? (
        <span className="text-muted-foreground shrink-0 text-xs">{hint}</span>
      ) : null}
    </button>
  );
}

export function ComposerMenuSeparator() {
  return <div className="bg-border my-1 h-px" />;
}
