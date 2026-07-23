import { useComposerAddAttachment } from '@assistant-ui/core/react';
import {
  BookOpenIcon,
  CrosshairIcon,
  FileIcon,
  ListTodoIcon,
  Minimize2Icon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type FC, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAui, useAuiState } from '@assistant-ui/store';
import { applyCompactToThread } from '@/lib/compact-context';
import { getChatSettings } from '@/lib/chat-settings';
import { commitPendingSkillAtEnd } from '@/lib/composer-pending-skill';
import { subscribeLayoutSync } from '@/lib/overlay-bounds';
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { DismissibleBackdrop } from '@/components/ui/dismissible-backdrop';
import {
  ComposerMenuFlyoutItem,
  ComposerMenuPanel,
  ComposerMenuRow,
  ComposerMenuSeparator,
} from '@/components/assistant-ui/composer-menu-flyout';
import { ComposerMcpFlyout } from '@/components/assistant-ui/composer-mcp-flyout';
import { ComposerSkillsFlyout } from '@/components/assistant-ui/composer-skills-flyout';
import { addComposerFiles } from '@/lib/add-composer-files';
import { pickComposerFiles } from '@/lib/pick-composer-files';
import {
  useAgentContext,
  useGoalLoopState,
  useMcpEnabled,
  usePendingSkill,
  usePlanMode,
  useProjectScope,
} from '@/lib/use-composer-settings';
import { useOverlayDismiss } from '@/lib/overlay-dismiss';
import type { MenuAnchor } from '@/components/assistant-ui/composer-mention/composer-menu-shared';

type Submenu = 'skills' | 'mcp' | null;

function usePlusMenuAnchor(open: boolean, anchorRef: RefObject<HTMLElement | null>) {
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
        width: Math.max(240, rect.width),
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

export const ComposerPlusMenu: FC = () => {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const aui = useAui();
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const [open, setOpen] = useState(false);
  const anchor = usePlusMenuAnchor(open, anchorRef);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mcpSearch, setMcpSearch] = useState('');
  const [compacting, setCompacting] = useState(false);
  const hoverArmedRef = useRef(false);
  const { addAttachment } = useComposerAddAttachment();

  const { planMode, togglePlanMode } = usePlanMode();
  const {
    goalActive,
    pendingGoal,
    loopActive,
    pendingLoop,
    toggleGoal,
    toggleLoop,
  } = useGoalLoopState();
  const { setPendingSkill } = usePendingSkill();
  const { isServerEnabled, setServerEnabled } = useMcpEnabled();
  const { groupedServers, currentProject, selectProject } = useProjectScope();
  const { context } = useAgentContext(open);

  const close = useCallback(() => {
    setOpen(false);
    setSubmenu(null);
    setSearchQuery('');
    setMcpSearch('');
    hoverArmedRef.current = false;
  }, []);

  const clearSubmenu = useCallback(() => setSubmenu(null), []);

  const openSubmenu = useCallback((next: Submenu) => {
    if (!hoverArmedRef.current) return;
    setSubmenu(next);
  }, []);

  const armHoverOnPointerMove = useCallback(() => {
    hoverArmedRef.current = true;
  }, []);

  useOverlayDismiss(close);

  const openFilePicker = useCallback(() => {
    if (!addAttachment) return;
    void (async () => {
      const files = await pickComposerFiles({ multiple: true });
      if (files.length > 0) {
        await addComposerFiles((file) => addAttachment(file), files);
      }
    })();
    close();
  }, [addAttachment, close]);

  const selectSkill = (name: string) => {
    const composer = aui.composer();
    const text = composer.getState().text;
    commitPendingSkillAtEnd(
      (next) => composer.setText(next),
      setPendingSkill,
      text,
      name,
    );
    close();
  };

  const compactContext = useCallback(async () => {
    if (!threadId || compacting) return;
    setCompacting(true);
    try {
      const { model } = getChatSettings();
      const result = await applyCompactToThread(aui, threadId, model);
      if (!result.ok) {
        alert(t('slash.compactFailed', { error: result.error }));
      } else {
        alert(t('slash.compactDone', { before: result.before, after: result.after }));
      }
    } finally {
      setCompacting(false);
      close();
    }
  }, [aui, threadId, compacting, close, t]);

  const skills = context?.skills ?? [];
  const mcpServers = context?.mcpServers ?? [];
  const groupOf = useCallback(
    (name: string) => groupedServers.find((s) => s.name === name)?.group,
    [groupedServers],
  );
  const goalMode = pendingGoal || goalActive;
  const loopMode = pendingLoop || loopActive;

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <TooltipIconButton
        tooltip={t('mention.title')}
        side="bottom"
        type="button"
        variant="ghost"
        size="icon"
        className="aui-composer-plus hover:bg-muted-foreground/15 size-7 rounded-full"
        aria-label={t('mention.title')}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) {
              hoverArmedRef.current = false;
              setSubmenu(null);
              setSearchQuery('');
              setMcpSearch('');
            } else {
              hoverArmedRef.current = false;
              setSubmenu(null);
            }
            return next;
          });
        }}
      >
        <PlusIcon className="size-4.5 stroke-[1.5px]" />
      </TooltipIconButton>

      {open &&
        anchor &&
        createPortal(
          <>
            <DismissibleBackdrop ariaLabel={t('mention.close')} onClose={close} />
            <div
              className="fixed z-[201]"
              style={{
                left: anchor.left,
                width: anchor.width,
                bottom: anchor.bottom,
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerMove={armHoverOnPointerMove}
            >
              <ComposerMenuPanel className="min-w-[240px]">
                <div className="px-1 pb-1" onMouseEnter={clearSubmenu}>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('mention.searchPlaceholder')}
                    className="border-input bg-background placeholder:text-muted-foreground h-8 w-full rounded-md border px-2.5 text-xs outline-none"
                  />
                </div>

                <ComposerMenuRow
                  icon={<ListTodoIcon className="size-4" />}
                  label={t('slash.plan')}
                  pressed={planMode}
                  onMouseEnter={clearSubmenu}
                  onClick={() => {
                    togglePlanMode();
                    close();
                  }}
                />
                <ComposerMenuRow
                  icon={<CrosshairIcon className="size-4" />}
                  label={goalMode ? t('slash.exitGoal') : t('slash.goal')}
                  pressed={goalMode}
                  title={t('slash.goalDesc')}
                  onMouseEnter={clearSubmenu}
                  onClick={() => {
                    toggleGoal();
                    close();
                  }}
                />
                <ComposerMenuRow
                  icon={<RefreshCwIcon className="size-4" />}
                  label={loopMode ? t('slash.stopLoop') : t('slash.loop')}
                  pressed={loopMode}
                  title={t('slash.loopDesc')}
                  onMouseEnter={clearSubmenu}
                  onClick={() => {
                    toggleLoop();
                    close();
                  }}
                />
                <ComposerMenuSeparator />

                <ComposerMenuRow
                  icon={<FileIcon className="size-4" />}
                  label={t('mention.file')}
                  onMouseEnter={clearSubmenu}
                  onClick={openFilePicker}
                />

                <ComposerMenuFlyoutItem
                  icon={<BookOpenIcon className="size-4" />}
                  label={t('slash.skills')}
                  active={submenu === 'skills'}
                  onOpen={() => openSubmenu('skills')}
                  onClose={clearSubmenu}
                >
                  <ComposerSkillsFlyout
                    skills={skills}
                    query={searchQuery}
                    onSelect={selectSkill}
                  />
                </ComposerMenuFlyoutItem>

                <ComposerMenuFlyoutItem
                  icon={<PlugIcon className="size-4" />}
                  label={t('mention.mcp')}
                  active={submenu === 'mcp'}
                  onOpen={() => openSubmenu('mcp')}
                  onClose={clearSubmenu}
                >
                  <ComposerMcpFlyout
                    servers={mcpServers}
                    query={mcpSearch}
                    onQueryChange={setMcpSearch}
                    isEnabled={isServerEnabled}
                    onToggle={setServerEnabled}
                    groupOf={groupOf}
                    currentProject={currentProject}
                    onSelectProject={selectProject}
                  />
                </ComposerMenuFlyoutItem>

                <ComposerMenuRow
                  icon={<Minimize2Icon className="size-4" />}
                  label={compacting ? t('slash.compacting') : t('slash.compact')}
                  onMouseEnter={clearSubmenu}
                  onClick={() => {
                    if (!threadId || compacting) return;
                    void compactContext();
                  }}
                />
              </ComposerMenuPanel>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};
