import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';

export type MenuAnchor = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
};

export function ComposerMenuSection({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
      {children}
    </div>
  );
}

export function ComposerTriggerMenuShell({
  open,
  anchor,
  ariaLabel,
  closeLabel,
  onClose,
  children,
  maxHeight = 'max-h-80',
}: {
  open: boolean;
  anchor: MenuAnchor;
  ariaLabel: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  maxHeight?: string;
}) {
  if (!open) return null;

  return createPortal(
    <>
      <DismissibleBackdrop ariaLabel={closeLabel} onClose={onClose} />
      <div
        className={`bg-popover text-popover-foreground fixed z-[201] ${maxHeight} w-[min(340px,calc(100vw-1rem))] overflow-y-auto rounded-lg border p-1 shadow-lg`}
        style={{
          top: anchor.top,
          bottom: anchor.bottom,
          left: anchor.left,
          width: anchor.width,
        }}
        role="listbox"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function ComposerMenuOption({
  active,
  icon,
  label,
  description,
  trailing,
  onClick,
  onMouseEnter,
  disabled,
}: {
  active: boolean;
  icon?: ReactNode;
  label: string;
  description?: string;
  trailing?: ReactNode;
  onClick: () => void;
  onMouseEnter?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={disabled}
      className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
        active ? 'bg-accent' : 'hover:bg-accent/60'
      } ${disabled ? 'opacity-50' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      {icon && (
        <span className="text-muted-foreground mt-0.5 flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description && (
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
            {description}
          </span>
        )}
      </span>
      {trailing}
    </button>
  );
}
