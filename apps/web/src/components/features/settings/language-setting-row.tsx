import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languageLabel, resolveAppLanguage, setAppLanguage, SUPPORTED_LANGUAGES } from '@/i18n';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import { cn } from '@/lib/utils';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';

export function LanguageSettingRow() {
  const { t, i18n } = useTranslation();
  const currentLang = resolveAppLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; width: number } | null>(
    null,
  );

  const currentLabel = languageLabel(currentLang);

  const close = useCallback(() => setOpen(false), []);

  useOverlayDismiss(close);

  const updateMenuPos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
      width: Math.max(rect.width, 144),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const stopLayout = subscribeLayoutSync(updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      stopLayout();
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  const menu =
    open && menuPos
      ? createPortal(
          <>
            <DismissibleBackdrop
              ariaLabel={t('settings.language.closeMenu')}
              onClose={close}
            />
            <div
              className="bg-popover text-popover-foreground fixed z-[201] overflow-hidden rounded-lg border p-1 shadow-lg"
              style={{
                top: menuPos.top,
                right: menuPos.right,
                minWidth: menuPos.width,
              }}
            >
              {SUPPORTED_LANGUAGES.map((lang) => {
                const active = currentLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                      active ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                    )}
                    onClick={() => {
                      void setAppLanguage(resolveAppLanguage(lang.code));
                      close();
                    }}
                  >
                    {active ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                    <span>{lang.label}</span>
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
      <div className="border-border bg-card rounded-xl border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t('settings.language.title')}</div>
            <div className="text-muted-foreground text-xs">{t('settings.language.hint')}</div>
          </div>
          <button
            ref={btnRef}
            type="button"
            className="border-input bg-background hover:bg-muted/50 flex h-9 min-w-[9rem] shrink-0 items-center justify-between gap-2 rounded-lg border py-1 pr-2 pl-3 text-sm"
            aria-label={t('settings.language.title')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="truncate">{currentLabel}</span>
            <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>
      {menu}
    </>
  );
}
