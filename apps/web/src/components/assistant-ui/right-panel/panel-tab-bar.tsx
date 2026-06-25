import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ComposerMenuPanel,
  ComposerMenuRow,
} from '@/components/assistant-ui/composer-menu-flyout';
import { RightSidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { PANEL_KINDS, getPanelKindDef } from './panel-registry';
import type { PanelKind, PanelTab } from './panel-types';

interface PanelTabBarProps {
  tabs: PanelTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: (kind: PanelKind) => void;
}

/** Browser-style tab strip + "+" menu (reference: pill active tab, icon + label). */
export const PanelTabBar: FC<PanelTabBarProps> = ({
  tabs,
  activeId,
  onActivate,
  onClose,
  onOpen,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const close = useCallback(() => setMenuOpen(false), []);

  const updateMenuPos = useCallback(() => {
    const el = addBtnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 220;
    const padding = 8;
    // "+" sits on the right edge — anchor menu's right side to the button.
    let right = window.innerWidth - rect.right;
    const left = rect.right - menuWidth;
    if (left < padding) {
      right = window.innerWidth - menuWidth - padding;
    }
    setMenuPos({ top: rect.bottom + 6, right });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
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
  }, [menuOpen, updateMenuPos]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, close]);

  const menu =
    menuOpen && menuPos
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200]"
              aria-label={t('panelTab.closeMenu')}
              onClick={close}
            />
            <div
              className="fixed z-[201]"
              style={{ top: menuPos.top, right: menuPos.right }}
              onClick={(e) => e.stopPropagation()}
            >
              <ComposerMenuPanel className="w-[220px] p-1 shadow-lg">
                {PANEL_KINDS.map((def) => (
                  <ComposerMenuRow
                    key={def.kind}
                    icon={def.icon}
                    label={t(def.label)}
                    title={def.description ? t(def.description) : undefined}
                    onClick={() => {
                      onOpen(def.kind);
                      close();
                    }}
                  />
                ))}
              </ComposerMenuPanel>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="border-border bg-background flex h-8 shrink-0 items-center border-b pl-2 pr-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = activeId === tab.id;
            const def = getPanelKindDef(tab.kind);
            return (
              <div
                key={tab.id}
                className={cn(
                  'group/tab flex max-w-[11rem] shrink-0 items-center rounded-lg text-xs transition-colors',
                  '[&:hover_.panel-tab-close]:ml-0.5 [&:hover_.panel-tab-close]:max-w-5 [&:hover_.panel-tab-close]:opacity-100',
                  active
                    ? 'bg-muted text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => onActivate(tab.id)}
                  className="panel-tab-label flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5 pr-1"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center opacity-70">
                    {def?.icon}
                  </span>
                  <span className="truncate">{t(tab.title)}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('panelTab.close', { title: t(tab.title) })}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    'panel-tab-close mr-1 overflow-hidden rounded-md p-0.5 transition-all duration-150',
                    'max-w-0 opacity-0',
                    'hover:bg-foreground/10',
                  )}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          ref={addBtnRef}
          type="button"
          aria-label={t('panelTab.new')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground ml-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors',
            menuOpen && 'bg-muted text-foreground border-border',
          )}
        >
          <Plus className="size-3.5" />
        </button>
        <RightSidebarTrigger className="ml-1 size-7" />
      </div>
      {menu}
    </>
  );
};
