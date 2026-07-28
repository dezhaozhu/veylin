import { ThreadListPrimitive, useAui } from '@assistant-ui/react';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  LoaderIcon,
  PlusIcon,
  SquarePenIcon,
} from 'lucide-react';
import {
  useCallback,
  useMemo,
  useState,
  type FC,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RowMenu, RowMenuItem } from '@/components/assistant-ui/thread-list-row-menu';
import {
  FormField,
  FormInput,
  SettingsFormDialog,
} from '@/components/features/settings/settings-form-dialog';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { placeComposerCaret } from '@/lib/composer-caret';
import { postThreadProject, writeCachedThreadProject } from '@/lib/project-sync';
import { invalidateThreadProjects } from '@/lib/thread-projects-sync';
import { createProject, invalidateProjects, type ProjectInfo } from '@/lib/projects-sync';
import { projectSourceLabel } from '@/lib/project-labels';
import { cn } from '@/lib/utils';
import { ThreadListItem } from '@/components/assistant-ui/thread-list-item';

export type ProjectBucket = { project: ProjectInfo; indices: number[] };

const COLLAPSE_KEY = 'veylin-project-collapse';

function readCollapsedSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsedSet(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* best-effort */
  }
}

/** Row menu for a project — rename/reorder are still future work, so the only
 * action is jumping to the MCP settings screen where the underlying compass
 * connection is managed. */
const ProjectRowMenu: FC = () => {
  const { t } = useTranslation();
  const { openCustomize } = useSettingsPanel();
  return (
    <RowMenu ariaLabel={t('threadList.moreOptions')} closeLabel={t('mention.close')}>
      {(close) => (
        <RowMenuItem
          label={t('mention.openMcpSettings')}
          onClick={() => {
            openCustomize('mcp');
            close();
          }}
        />
      )}
    </RowMenu>
  );
};

const ProjectRow: FC<{ project: ProjectInfo; indices: number[]; threadIds: readonly string[] }> = ({
  project,
  indices,
  threadIds,
}) => {
  const { t } = useTranslation();
  const aui = useAui();
  const { openProject } = useSettingsPanel();
  // Collapse state is keyed by project.id (stable across renames).
  const [open, setOpen] = useState(() => !readCollapsedSet().has(project.id));
  const [creating, setCreating] = useState(false);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      const set = readCollapsedSet();
      if (next) set.delete(project.id);
      else set.add(project.id);
      writeCollapsedSet(set);
      return next;
    });
  }, [project.id]);

  // Split affordances: the NAME row opens the main-area 项目首页, the chevron
  // keeps its collapse/expand behavior. stopPropagation matters — with a
  // workspace view already open, ThreadListSidebar's SidebarContent onClick is
  // closeWorkspace, which would otherwise win over openProject in the same
  // batch and bounce the user back to chat.
  const navigate = useCallback(
    (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation();
      openProject(project.id, project.name);
    },
    [openProject, project.id, project.name],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Only when the row itself is focused — the chevron button's own
      // Enter/Space (toggle) bubbles through here and must not navigate.
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigate(e);
      }
    },
    [navigate],
  );

  const handleNewChat = useCallback(
    async (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (creating) return;
      setCreating(true);
      try {
        // Same creation path as the global new-chat control (ThreadListPrimitive.New):
        // aui.threads().switchToNewThread(); here we additionally force-initialize so
        // we have a real server threadId to pin immediately, instead of waiting for
        // the first message.
        await aui.threads().switchToNewThread();
        const item = aui.threads().item('main');
        const initialized = await item.initialize();
        // Same triple fallback as thread-list.tsx's partitionByProject / the
        // move menu — the local id later BECOMES the remoteId, so this always
        // resolves to the id the pin ends up keyed under.
        const rid = initialized.remoteId ?? initialized.externalId ?? item.getState().id;
        // The pin value is the project id (POST /api/project validates it as
        // an enabled project of this tenant).
        const confirmed = await postThreadProject(rid, project.id);
        writeCachedThreadProject(rid, confirmed ?? project.id);
        invalidateThreadProjects();
        placeComposerCaret(0);
      } catch (err) {
        console.error('[project-list] new chat in project failed:', err);
      } finally {
        setCreating(false);
      }
    },
    [aui, project.id, creating],
  );

  return (
    <div className="aui-project-row">
      <div
        role="button"
        tabIndex={0}
        onClick={navigate}
        onKeyDown={handleKeyDown}
        className="group/project-row hover:bg-muted focus-visible:bg-muted relative flex h-8 cursor-pointer items-center gap-1 rounded-md transition-colors focus-visible:outline-none"
      >
        <span className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-start text-sm">
          <button
            type="button"
            aria-expanded={open}
            aria-label={t('threadList.toggleProject', { name: project.name })}
            className="hover:bg-muted-foreground/15 -m-0.5 flex shrink-0 items-center justify-center rounded p-0.5 focus-visible:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <ChevronRightIcon
              className={cn(
                'text-muted-foreground size-3.5 shrink-0 transition-transform',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          </button>
          {open ? (
            <FolderOpenIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          ) : (
            <FolderIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5 pe-1.5 opacity-0 pointer-events-none transition-opacity group-hover/project-row:opacity-100 group-hover/project-row:pointer-events-auto">
          <ProjectRowMenu />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={creating}
            className="text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground size-6 shrink-0 p-0"
            aria-label={t('threadList.newChatInProject', { name: project.name })}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleNewChat}
          >
            {creating ? (
              <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <SquarePenIcon className="size-3.5" aria-hidden />
            )}
          </Button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-0.5 pl-4">
          {indices.length === 0 ? (
            <div className="text-muted-foreground px-2.5 py-1 text-xs italic">
              {t('threadList.emptyProject')}
            </div>
          ) : (
            indices.map((index) => (
              <ThreadListPrimitive.ItemByIndex
                key={threadIds[index]}
                index={index}
                components={{ ThreadListItem }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

/** 新建项目 dialog — name + source checkboxes. The tickable sources are the
 * granted ones, i.e. the sources of the reconciler-managed default projects
 * (same definition the server's POST /api/projects validation uses); labels
 * via the shared source-label map. Server 400s (e.g. a just-revoked source)
 * surface inline. */
const NewProjectDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buckets: ProjectBucket[];
}> = ({ open, onOpenChange, buckets }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sourceOptions = useMemo(
    () =>
      Array.from(
        new Set(buckets.flatMap((b) => (b.project.managed ? b.project.sources : []))),
      ).sort(),
    [buckets],
  );

  const toggleSource = useCallback((source: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setName('');
    setTicked(new Set());
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createProject(name.trim(), Array.from(ticked));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      invalidateProjects();
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [name, ticked, submitting, reset, onOpenChange]);

  return (
    <SettingsFormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('threadList.newProject')}
      submitLabel={submitting ? t('threadList.creatingProject') : t('common.create')}
      onSubmit={() => void submit()}
    >
      <FormField label={t('common.name')} required>
        <FormInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </FormField>
      <FormField label={t('threadList.projectSources')} required>
        <div className="flex flex-col gap-1.5">
          {sourceOptions.map((source) => (
            <label key={source} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={ticked.has(source)}
                onChange={() => toggleSource(source)}
              />
              <span>{projectSourceLabel(source)}</span>
            </label>
          ))}
        </div>
      </FormField>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </SettingsFormDialog>
  );
};

export const ProjectsSection: FC<{
  buckets: ProjectBucket[];
  threadIds: readonly string[];
}> = ({ buckets, threadIds }) => {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  if (buckets.length === 0) return null;
  return (
    <div className="aui-project-list flex flex-col gap-0.5">
      <div className="aui-thread-list-group-label text-muted-foreground group/project-header flex items-center justify-between px-2.5 pt-3 pb-1 text-xs font-medium">
        <span>{t('threadList.projects')}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground size-5 shrink-0 p-0 opacity-0 transition-opacity group-hover/project-header:opacity-100 focus-visible:opacity-100"
          aria-label={t('threadList.newProject')}
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-3.5" aria-hidden />
        </Button>
      </div>
      {buckets.map((bucket) => (
        <ProjectRow
          key={bucket.project.id}
          project={bucket.project}
          indices={bucket.indices}
          threadIds={threadIds}
        />
      ))}
      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} buckets={buckets} />
    </div>
  );
};
