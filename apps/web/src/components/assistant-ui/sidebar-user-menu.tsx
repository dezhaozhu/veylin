import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Loader2, LogOut, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAppUpdater } from '@/hooks/use-app-updater';
import { useSession, logout } from '@/hooks/use-session';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { cn } from '@/lib/utils';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return (parts[0]?.[0] ?? 'U').toUpperCase();
}

export function SidebarUserMenu() {
  const { user } = useSession();
  const { openAppSettings } = useSettingsPanel();
  const {
    updateAvailable,
    version,
    installing,
    checkError,
    installError,
    installUpdate,
    refresh,
    clearErrors,
  } = useAppUpdater();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const displayName = user?.name ?? 'Dev User';

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div className="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-full min-w-[220px] overflow-hidden rounded-xl border p-1 shadow-lg">
          {(checkError || installError) && (
            <div className="text-destructive px-2.5 py-2 text-xs leading-snug">
              <p className="font-medium">{t('userMenu.updateFailed')}</p>
              <p className="text-destructive/90 mt-0.5">{installError ?? checkError}</p>
              <button
                type="button"
                className="text-primary mt-1 underline"
                onClick={() => {
                  clearErrors();
                  void refresh();
                }}
              >
                {t('splash.retry')}
              </button>
            </div>
          )}
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm"
            onClick={() => {
              close();
              openAppSettings();
            }}
          >
            <Settings className="text-muted-foreground size-4" />
            <span className="flex-1">{t('userMenu.settings')}</span>
          </button>
          <div className="bg-border my-1 h-px" />
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm"
            onClick={() => void logout()}
          >
            <LogOut className="text-muted-foreground size-4" />
            <span>{t('userMenu.logOut')}</span>
          </button>
        </div>
      )}

      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className={cn('data-[state=open]:bg-accent', open && 'bg-accent')}
            onClick={() => setOpen((o) => !o)}
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg text-xs font-medium">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 pl-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{displayName}</span>
              <span className="text-muted-foreground truncate text-xs">free</span>
            </div>
            {updateAvailable && (
              <span
                role="button"
                tabIndex={0}
                aria-disabled={installing}
                title={version ? t('userMenu.updateTo', { version }) : undefined}
                className={cn(
                  buttonVariants({ variant: 'default', size: 'xs' }),
                  'shrink-0',
                  installing && 'pointer-events-none opacity-70',
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void installUpdate();
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  void installUpdate();
                }}
              >
                {installing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t('userMenu.update')
                )}
              </span>
            )}
            <ChevronsUpDown className="text-muted-foreground ml-auto size-4 shrink-0" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}
