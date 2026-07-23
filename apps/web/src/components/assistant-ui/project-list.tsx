import { ThreadListPrimitive, useAui } from '@assistant-ui/react';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  LoaderIcon,
  SquarePenIcon,
} from 'lucide-react';
import { useCallback, useState, type FC, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RowMenu, RowMenuItem } from '@/components/assistant-ui/thread-list-row-menu';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { placeComposerCaret } from '@/lib/composer-caret';
import { setChatSettings } from '@/lib/chat-settings';
import { postThreadProject, writeCachedThreadProject } from '@/lib/project-sync';
import { invalidateThreadProjects } from '@/lib/thread-projects-sync';
import { projectLabel } from '@/lib/project-labels';
import { cn } from '@/lib/utils';
import { ThreadListItem } from '@/components/assistant-ui/thread-list-item';

export type ProjectBucket = { name: string; indices: number[] };

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

/** Row menu for a project — v1 has no project-level entity (see spec
 * non-goals: rename/reorder are future), so the only real action is jumping
 * to the MCP settings screen where grouped servers/projects are managed. */
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

const ProjectRow: FC<{ name: string; indices: number[]; threadIds: readonly string[] }> = ({
  name,
  indices,
  threadIds,
}) => {
  const { t } = useTranslation();
  const aui = useAui();
  const label = projectLabel(name);
  const [open, setOpen] = useState(() => !readCollapsedSet().has(name));
  const [creating, setCreating] = useState(false);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      const set = readCollapsedSet();
      if (next) set.delete(name);
      else set.add(name);
      writeCollapsedSet(set);
      return next;
    });
  }, [name]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
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
        const { remoteId } = await aui.threads().item('main').initialize();
        const confirmed = await postThreadProject(remoteId, name);
        writeCachedThreadProject(remoteId, confirmed ?? name);
        setChatSettings({ lastProject: confirmed ?? name });
        invalidateThreadProjects();
        placeComposerCaret(0);
      } catch (err) {
        console.error('[project-list] new chat in project failed:', err);
      } finally {
        setCreating(false);
      }
    },
    [aui, name, creating],
  );

  return (
    <div className="aui-project-row">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        className="group/project-row hover:bg-muted focus-visible:bg-muted relative flex h-8 cursor-pointer items-center gap-1 rounded-md transition-colors focus-visible:outline-none"
      >
        <span className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-start text-sm">
          <ChevronRightIcon
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          {open ? (
            <FolderOpenIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          ) : (
            <FolderIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5 pe-1.5 opacity-0 pointer-events-none transition-opacity group-hover/project-row:opacity-100 group-hover/project-row:pointer-events-auto">
          <ProjectRowMenu />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={creating}
            className="text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground size-6 shrink-0 p-0"
            aria-label={t('threadList.newChatInProject', { name: label })}
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

export const ProjectsSection: FC<{
  buckets: ProjectBucket[];
  threadIds: readonly string[];
}> = ({ buckets, threadIds }) => {
  const { t } = useTranslation();
  if (buckets.length === 0) return null;
  return (
    <div className="aui-project-list flex flex-col gap-0.5">
      <div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
        {t('threadList.projects')}
      </div>
      {buckets.map((bucket) => (
        <ProjectRow
          key={bucket.name}
          name={bucket.name}
          indices={bucket.indices}
          threadIds={threadIds}
        />
      ))}
    </div>
  );
};
