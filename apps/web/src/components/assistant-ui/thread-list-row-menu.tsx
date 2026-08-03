import { MoreHorizontalIcon, ChevronLeftIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';
import { cn } from '@/lib/utils';

/**
 * Shared "…" row-menu idiom for the Projects sidebar (thread row move/delete,
 * project row settings shortcut) — mirrors settings-list.tsx's SettingsRowMenu
 * (hover-revealed trigger, top/right-anchored portal dropdown, backdrop
 * dismiss) generalized to arbitrary content so it can host a drill-down view.
 */
export function RowMenu({
  ariaLabel,
  closeLabel,
  children,
  onOpenChange,
  className,
}: {
  ariaLabel: string;
  closeLabel: string;
  children: (close: () => void) => ReactNode;
  onOpenChange?: (open: boolean) => void;
  /** Merged onto the trigger's wrapping div — e.g. a hover-reveal class list
   * plus `data-[open=true]:opacity-100` so the trigger stays visible while
   * its portaled menu is open (mouse may be over the menu, not the row). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useOverlayDismiss(close);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    const stopLayout = subscribeLayoutSync(updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      stopLayout();
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, updatePos]);

  return (
    <div className={cn('relative shrink-0', className)} data-open={open}>
      <Button
        ref={btnRef}
        type="button"
        variant="ghost"
        size="icon"
        className="aui-row-menu-trigger text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground size-6 shrink-0 p-0"
        aria-label={ariaLabel}
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontalIcon className="size-3.5" />
      </Button>
      {open && pos
        ? createPortal(
            <>
              <DismissibleBackdrop ariaLabel={closeLabel} onClose={close} />
              <div
                className="aui-row-menu border-border bg-popover text-popover-foreground fixed z-[201] min-w-[12rem] overflow-hidden rounded-lg border p-1 shadow-lg"
                style={{ top: pos.top, right: pos.right }}
                onClick={(e) => e.stopPropagation()}
              >
                {children(close)}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

export function RowMenuItem({
  label,
  description,
  destructive,
  disabled,
  onClick,
}: {
  label: string;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={description}
      className={cn(
        'hover:bg-accent flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50',
        destructive && 'text-destructive hover:bg-destructive/10',
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
    >
      <span>{label}</span>
      {description && (
        <span className="text-muted-foreground text-xs font-normal">{description}</span>
      )}
    </button>
  );
}

export function RowMenuBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="hover:bg-accent text-muted-foreground flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs font-medium"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <ChevronLeftIcon className="size-3.5" />
      {label}
    </button>
  );
}

export function RowMenuSection({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground px-2.5 pt-1 pb-0.5 text-[11px] font-medium tracking-wide uppercase">
      {children}
    </div>
  );
}
