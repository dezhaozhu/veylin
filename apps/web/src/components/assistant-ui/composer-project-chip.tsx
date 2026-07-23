import { GemIcon } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type FC, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import { useProjectScope } from '@/lib/use-composer-settings';
import { cn } from '@/lib/utils';
import {
  ComposerMenuSection,
  ComposerTriggerMenuShell,
  type MenuAnchor,
} from '@/components/assistant-ui/composer-mention/composer-menu-shared';
import { ProjectRadioGroup } from '@/components/assistant-ui/composer-mcp-flyout';

function useProjectChipAnchor(open: boolean, anchorRef: RefObject<HTMLElement | null>) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }

    const updateAnchor = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setAnchor({
        left: rect.left,
        width: Math.max(220, rect.width),
        bottom: window.innerHeight - rect.top + 8,
      });
    };

    updateAnchor();
    const stopLayout = subscribeLayoutSync(updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    return () => {
      stopLayout();
      window.removeEventListener('scroll', updateAnchor, true);
    };
  }, [open, anchorRef]);

  return anchor;
}

/** Compact pin showing the current thread's project (grouped MCP server); only
 * rendered when the tenant has at least one grouped MCP server. Clicking opens
 * the same single-select radio list as the plus-menu's MCP section. */
export const ComposerProjectChip: FC = () => {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const anchor = useProjectChipAnchor(open, anchorRef);
  const { groupedServers, currentProject, selectProject } = useProjectScope();

  const close = useCallback(() => setOpen(false), []);
  useOverlayDismiss(close);

  if (groupedServers.length === 0) return null;

  return (
    <div ref={anchorRef} className="relative min-w-0 shrink-0">
      <button
        type="button"
        aria-expanded={open}
        className="text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground inline-flex h-7 max-w-[10rem] min-w-0 items-center gap-1 rounded-full px-2.5 text-xs font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        <GemIcon className="size-3 shrink-0" />
        <span className={cn('truncate', !currentProject && 'italic')}>
          {currentProject ?? t('mention.project')}
        </span>
      </button>
      {open && anchor ? (
        <ComposerTriggerMenuShell
          open={open}
          anchor={anchor}
          ariaLabel={t('mention.project')}
          closeLabel={t('mention.close')}
          onClose={close}
          maxHeight="max-h-60"
        >
          <ComposerMenuSection>{t('mention.project')}</ComposerMenuSection>
          <ProjectRadioGroup
            members={groupedServers.map((s) => s.name)}
            currentProject={currentProject}
            onSelect={selectProject}
          />
        </ComposerTriggerMenuShell>
      ) : null}
    </div>
  );
};
