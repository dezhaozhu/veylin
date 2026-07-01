import {
  Children,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { cn } from '@/lib/utils';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';

type SelectOption = { value: string; label: string };

function optionsFromChildren(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return;
    const props = child.props as { value?: string | number; children?: ReactNode };
    options.push({
      value: String(props.value ?? ''),
      label: String(props.children ?? props.value ?? ''),
    });
  });
  return options;
}

type MenuPos = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
};

export function SettingsSelect({
  value = '',
  onChange,
  children,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useOverlayDismiss(close);

  const updateMenuPos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estimatedHeight = options.length * 36 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;

    setMenuPos({
      left: rect.left,
      width: rect.width,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    window.addEventListener('resize', updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      window.removeEventListener('resize', updateMenuPos);
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  const emitChange = (next: string) => {
    onChange?.({
      target: { value: next },
      currentTarget: { value: next },
    } as ChangeEvent<HTMLSelectElement>);
  };

  const menu =
    open && menuPos
      ? createPortal(
          <>
            <DismissibleBackdrop ariaLabel="Close menu" onClose={close} />
            <div
              className="bg-popover text-popover-foreground fixed z-[201] max-h-60 overflow-y-auto rounded-lg border p-1 shadow-lg"
              style={{
                top: menuPos.top,
                bottom: menuPos.bottom,
                left: menuPos.left,
                minWidth: menuPos.width,
              }}
            >
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                      active ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                    )}
                    onClick={() => {
                      emitChange(option.value);
                      close();
                    }}
                  >
                    {active ? (
                      <Check className="size-3.5 shrink-0" />
                    ) : (
                      <span className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'border-input bg-background hover:bg-muted/50 flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {menu}
    </>
  );
}
