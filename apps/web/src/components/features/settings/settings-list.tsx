import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SettingsConnectedList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border bg-card divide-border divide-y overflow-hidden rounded-xl border',
        className,
      )}
    >
      {children}
    </div>
  );
}

export type SettingsRowMenuItem = {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

export function SettingsListRow({
  icon,
  title,
  badge,
  subtitle,
  subtitleAction,
  onSubtitleClick,
  menuItems,
  trailing,
  className,
  asButton,
  onClick,
  subtitleClamp = 1,
}: {
  icon: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  subtitleAction?: boolean;
  onSubtitleClick?: () => void;
  menuItems?: SettingsRowMenuItem[];
  trailing?: ReactNode;
  className?: string;
  asButton?: boolean;
  onClick?: () => void;
  /** 1 = single-line ellipsis; 2 = up to two lines before ellipsis */
  subtitleClamp?: 1 | 2;
}) {
  const subtitleClass =
    subtitleClamp === 2
      ? 'text-muted-foreground line-clamp-2 text-xs leading-snug'
      : 'text-muted-foreground truncate text-xs';

  const inner = (
    <>
      <div className="relative shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {badge}
        </div>
        {subtitle != null && subtitle !== '' && (
          <div className="mt-0.5 flex min-w-0 items-center gap-0.5">
            {onSubtitleClick ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSubtitleClick();
                }}
                className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-0.5 text-xs transition-colors"
              >
                <span className={subtitleClamp === 2 ? 'line-clamp-2 leading-snug' : 'truncate'}>
                  {subtitle}
                </span>
                {subtitleAction && <ChevronRight className="size-3 shrink-0 opacity-60" />}
              </button>
            ) : (
              <p className={subtitleClass}>{subtitle}</p>
            )}
          </div>
        )}
      </div>
      {trailing}
      {menuItems && menuItems.length > 0 && <SettingsRowMenu items={menuItems} />}
    </>
  );

  const rowClass = cn(
    'group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
    asButton && 'hover:bg-accent/40 cursor-pointer',
    className,
  );

  if (asButton) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={rowClass}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        }}
      >
        {inner}
      </div>
    );
  }

  return <div className={rowClass}>{inner}</div>;
}

export function SettingsListIcon({
  children,
  statusDot,
  className,
}: {
  children: ReactNode;
  statusDot?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-muted text-muted-foreground relative flex size-8 items-center justify-center rounded-lg',
        className,
      )}
    >
      {children}
      {statusDot && (
        <span className="border-card absolute -right-0.5 -bottom-0.5 size-2 rounded-full border bg-emerald-500" />
      )}
    </div>
  );
}

function SettingsRowMenu({ items }: { items: SettingsRowMenuItem[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const updateMenuPos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const menu =
    open && menuPos
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200] cursor-default bg-transparent"
              aria-label={t('common.close')}
              onClick={close}
            />
            <div
              className="border-border bg-popover text-popover-foreground fixed z-[201] min-w-[9rem] overflow-hidden rounded-lg border p-1 shadow-md"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={item.disabled}
                  className={cn(
                    'hover:bg-accent flex w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50',
                    item.destructive && 'text-destructive hover:bg-destructive/10',
                  )}
                  onClick={() => {
                    close();
                    item.onClick();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="relative shrink-0" data-no-window-drag>
      <Button
        ref={btnRef}
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground size-7 opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
        aria-label={t('common.moreOptions')}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {menu}
    </div>
  );
}
