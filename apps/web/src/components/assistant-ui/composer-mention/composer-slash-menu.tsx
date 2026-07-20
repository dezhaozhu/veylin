import {
  CrosshairIcon,
  ListTodoIcon,
  Minimize2Icon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FC, type ReactNode, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useAui, useAuiState } from '@assistant-ui/store';
import { applyCompactToThread } from '@/lib/compact-context';
import { getChatSettings } from '@/lib/chat-settings';
import { commitPendingSkillSelection } from '@/lib/composer-pending-skill';
import {
  useAgentContext,
  useGoalLoopState,
  usePendingSkill,
  usePlanMode,
} from '@/lib/use-composer-settings';
import {
  ComposerMenuOption,
  ComposerMenuSection,
  ComposerTriggerMenuShell,
} from './composer-menu-shared';
import { useComposerMenuKeyboard } from './use-composer-menu-keyboard';
import { skillMenuDescription } from '@/lib/skill-menu-description';
import type { MentionTrigger } from './use-composer-mention';

const PREVIEW_COUNT = 5;

type SlashRow =
  | { kind: 'skill'; name: string; description: string }
  | { kind: 'plan'; exit: boolean }
  | { kind: 'goal'; exit: boolean }
  | { kind: 'loop'; exit: boolean }
  | { kind: 'compact' };

export const ComposerSlashMenu: FC<{
  open: boolean;
  trigger: MentionTrigger;
  anchor: { top?: number; bottom?: number; left: number; width: number };
  onClose: () => void;
}> = ({ open, trigger, anchor, onClose }) => {
  const { t } = useTranslation();
  const aui = useAui();
  const threadId = useAuiState(
    (s) =>
      s.threadListItem.remoteId ??
      s.threadListItem.externalId ??
      s.threadListItem.id,
  );
  const { context } = useAgentContext(open);
  const { setPendingSkill } = usePendingSkill();
  const { planMode, setPlanMode } = usePlanMode();
  const {
    goalActive,
    pendingGoal,
    loopActive,
    pendingLoop,
    toggleGoal,
    toggleLoop,
  } = useGoalLoopState();
  const goalMode = pendingGoal || goalActive;
  const loopMode = pendingLoop || loopActive;
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [compacting, setCompacting] = useState(false);

  const query = trigger.query.toLowerCase();

  const skills = useMemo(() => {
    const all = context?.skills ?? [];
    if (!query) return all;
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query),
    );
  }, [context?.skills, query]);

  const visibleSkills = skillsExpanded || query ? skills : skills.slice(0, PREVIEW_COUNT);
  const hiddenSkillCount = Math.max(0, skills.length - PREVIEW_COUNT);

  const rows = useMemo((): SlashRow[] => {
    const items: SlashRow[] = [];
    for (const skill of visibleSkills) {
      items.push({ kind: 'skill', name: skill.name, description: skill.description });
    }
    const matches = (...labels: string[]) =>
      !query || labels.some((label) => label.toLowerCase().includes(query));

    if (matches(t('slash.plan'), t('slash.exitPlan'), t('slash.planDesc'))) {
      items.push({ kind: 'plan', exit: planMode });
    }
    if (matches(t('slash.goal'), t('slash.exitGoal'), t('slash.goalDesc'))) {
      items.push({ kind: 'goal', exit: goalMode });
    }
    if (matches(t('slash.loop'), t('slash.stopLoop'), t('slash.loopDesc'))) {
      items.push({ kind: 'loop', exit: loopMode });
    }
    if (
      threadId &&
      matches(t('slash.compact'), t('slash.compactDesc'))
    ) {
      items.push({ kind: 'compact' });
    }
    return items;
  }, [
    visibleSkills,
    query,
    t,
    planMode,
    goalMode,
    loopMode,
    threadId,
  ]);

  useEffect(() => {
    if (!open) {
      setSkillsExpanded(false);
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, skillsExpanded]);

  const clearSlashFromInput = useCallback(() => {
    const composer = aui.composer();
    const text = composer.getState().text;
    composer.setText(text.slice(0, trigger.start) + text.slice(trigger.end));
    onClose();
  }, [aui, trigger, onClose]);

  /**
   * Close the slash menu before mutating mode state so the open menu does not
   * flash "退出计划" / etc. while planMode flips.
   */
  const closeThen = useCallback(
    (action: () => void) => {
      clearSlashFromInput();
      queueMicrotask(action);
    },
    [clearSlashFromInput],
  );

  const replaceSlashWithSkill = useCallback(
    (name: string) => {
      const composer = aui.composer();
      const text = composer.getState().text;
      commitPendingSkillSelection(
        (next) => composer.setText(next),
        setPendingSkill,
        text,
        name,
        trigger.start,
        trigger.end,
      );
      onClose();
    },
    [aui, trigger, onClose, setPendingSkill],
  );

  const pickSkill = useCallback(
    (name: string) => {
      replaceSlashWithSkill(name);
    },
    [replaceSlashWithSkill],
  );

  const pickPlan = useCallback(
    (exit: boolean) => {
      closeThen(() => setPlanMode(!exit));
    },
    [closeThen, setPlanMode],
  );

  const pickGoal = useCallback(() => {
    closeThen(() => toggleGoal());
  }, [closeThen, toggleGoal]);

  const pickLoop = useCallback(() => {
    closeThen(() => toggleLoop());
  }, [closeThen, toggleLoop]);

  const runCompact = useCallback(async () => {
    if (!threadId || compacting) return;
    setCompacting(true);
    try {
      const { model } = getChatSettings();
      await applyCompactToThread(aui, threadId, model);
    } finally {
      setCompacting(false);
      clearSlashFromInput();
    }
  }, [aui, threadId, compacting, clearSlashFromInput]);

  const activateRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      if (row.kind === 'skill') pickSkill(row.name);
      else if (row.kind === 'plan') pickPlan(row.exit);
      else if (row.kind === 'goal') pickGoal();
      else if (row.kind === 'loop') pickLoop();
      else if (row.kind === 'compact') void runCompact();
    },
    [rows, pickSkill, pickPlan, pickGoal, pickLoop, runCompact],
  );

  useComposerMenuKeyboard({
    open,
    itemCount: rows.length,
    activeIndex,
    setActiveIndex,
    onActivate: activateRow,
    onClose,
  });

  const showSections = !query;
  const sectionForRow = (row: SlashRow): string | null => {
    if (!showSections) return null;
    if (row.kind === 'skill') return t('slash.skills');
    return t('slash.commands');
  };

  if (!open) return null;

  const lastSkillIndex = rows.reduce(
    (acc, row, i) => (row.kind === 'skill' ? i : acc),
    -1,
  );

  const menuBody = (
    <>
      {rows.length === 0 && (
        <p className="text-muted-foreground px-2.5 py-3 text-xs">{t('slash.noMatches')}</p>
      )}

      {rows.map((row, index) => {
        const section = sectionForRow(row);
        const prevSection = index > 0 ? sectionForRow(rows[index - 1]!) : null;
        const showHeader = section != null && section !== prevSection;

        let option: ReactNode;
        if (row.kind === 'skill') {
          option = (
            <ComposerMenuOption
              active={activeIndex === index}
              icon={<SparklesIcon className="size-4" />}
              label={row.name}
              description={skillMenuDescription(row.description)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateRow(index)}
            />
          );
        } else if (row.kind === 'plan') {
          option = (
            <ComposerMenuOption
              active={activeIndex === index}
              icon={<ListTodoIcon className="size-4" />}
              label={row.exit ? t('slash.exitPlan') : t('slash.plan')}
              description={row.exit ? t('slash.exitPlanDesc') : t('slash.planDesc')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateRow(index)}
            />
          );
        } else if (row.kind === 'goal') {
          option = (
            <ComposerMenuOption
              active={activeIndex === index}
              icon={<CrosshairIcon className="size-4" />}
              label={row.exit ? t('slash.exitGoal') : t('slash.goal')}
              description={t('slash.goalDesc')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateRow(index)}
            />
          );
        } else if (row.kind === 'loop') {
          option = (
            <ComposerMenuOption
              active={activeIndex === index}
              icon={<RefreshCwIcon className="size-4" />}
              label={row.exit ? t('slash.stopLoop') : t('slash.loop')}
              description={t('slash.loopDesc')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateRow(index)}
            />
          );
        } else {
          option = (
            <ComposerMenuOption
              active={activeIndex === index}
              icon={<Minimize2Icon className="size-4" />}
              label={compacting ? t('slash.compacting') : t('slash.compact')}
              description={t('slash.compactDesc')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateRow(index)}
            />
          );
        }

        return (
          <Fragment
            key={
              row.kind === 'skill'
                ? `skill-${row.name}`
                : `${row.kind}-${row.kind === 'plan' || row.kind === 'goal' || row.kind === 'loop' ? String(row.exit) : 'x'}`
            }
          >
            {showHeader && <ComposerMenuSection>{section}</ComposerMenuSection>}
            {option}
            {index === lastSkillIndex &&
              !query &&
              !skillsExpanded &&
              hiddenSkillCount > 0 && (
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-accent/60 w-full rounded-md px-2.5 py-1.5 text-left text-xs"
                  onClick={() => setSkillsExpanded(true)}
                >
                  {t('slash.showMore', { count: hiddenSkillCount })}
                </button>
              )}
          </Fragment>
        );
      })}
    </>
  );

  return (
    <ComposerTriggerMenuShell
      open={open}
      anchor={anchor}
      ariaLabel={t('slash.title')}
      closeLabel={t('slash.close')}
      onClose={onClose}
    >
      {menuBody}
    </ComposerTriggerMenuShell>
  );
};
