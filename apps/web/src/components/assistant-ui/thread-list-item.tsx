import { ThreadListItemPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { LoaderIcon, MinusIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTimeShort } from "@/lib/format-relative-time";
import {
  ackThreadActivity,
  shouldShowThreadActivityBadge,
  onThreadActivityAckChange,
} from "@/lib/thread-activity-ack";
import { type ThreadActivity } from "@/lib/use-thread-activity";
import { useGroupedMcpServers } from "@/lib/mcp-groups-sync";
import { useThreadProjects, invalidateThreadProjects } from "@/lib/thread-projects-sync";
import { postThreadProject, writeCachedThreadProject } from "@/lib/project-sync";
import { projectLabel } from "@/lib/project-labels";
import {
  RowMenu,
  RowMenuBack,
  RowMenuItem,
  RowMenuSection,
} from "@/components/assistant-ui/thread-list-row-menu";

/** Shared with thread-list.tsx (which provides the value at the sidebar root)
 * and project-list.tsx (whose project buckets render this same item). Lives
 * here — not in thread-list.tsx — so both can import ThreadListItem without a
 * module cycle. */
export const ThreadActivityContext = createContext<Record<string, ThreadActivity>>({});

const ThreadListItemTime: FC = () => {
  const itemId = useAuiState((s) => s.threadListItem.id);
  const lastMessageAt = useAuiState((s) => s.threadListItem.lastMessageAt);
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const isNewest = useMemo(() => {
    if (threadIds.length === 0) return true;
    let bestId = threadIds[0]!;
    let bestTime = Number.NEGATIVE_INFINITY;
    const byId = new Map(threadItems.map((item) => [item.id, item]));
    for (const id of threadIds) {
      // Missing lastMessageAt sorts as newest (just-created / in-flight).
      const t = byId.get(id)?.lastMessageAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (t >= bestTime) {
        bestTime = t;
        bestId = id;
      }
    }
    return itemId === bestId;
  }, [itemId, threadIds, threadItems]);

  // Only the single newest thread may show "now"; everyone else stays on 1m/2h/….
  const label =
    isNewest &&
    (!lastMessageAt || now - lastMessageAt.getTime() < 60_000)
      ? 'now'
      : lastMessageAt
        ? formatRelativeTimeShort(lastMessageAt, now)
        : '1m';

  return (
    <span className="aui-thread-list-item-time text-muted-foreground w-9 shrink-0 text-right text-xs tabular-nums">
      {label}
    </span>
  );
};

const ThreadListItemActivityBadge: FC<{
  kind: ThreadActivity["kind"];
}> = ({ kind }) => {
  const { t } = useTranslation();
  if (kind === "running") {
    return (
      <LoaderIcon
        className="text-primary size-3.5 shrink-0 animate-spin"
        aria-label={t("threadList.running")}
      />
    );
  }
  if (kind === "finished") {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-green-500"
        aria-label={t("threadList.finished")}
      />
    );
  }
  return (
    <MinusIcon
      className="text-muted-foreground size-3.5 shrink-0"
      aria-label={t("threadList.interrupted")}
    />
  );
};

/** "…" row menu: move-to-project drill-down (only when the tenant has grouped
 * MCP servers) + delete. Extends what used to be a lone delete icon. */
const ThreadListItemMenu: FC = () => {
  const { t } = useTranslation();
  const aui = useAui();
  const id = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const groupedServers = useGroupedMcpServers();
  const threadProjects = useThreadProjects();
  const [view, setView] = useState<'root' | 'move'>('root');
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [movingTo, setMovingTo] = useState<string | null>(null);

  const currentProject = remoteId ? threadProjects[remoteId] : undefined;

  const handleDelete = useCallback(
    async (close: () => void) => {
      if (deletingRef.current) return;
      deletingRef.current = true;
      setDeleting(true);
      try {
        const runtime = aui.threads().item({ id }).__internal_getRuntime?.();
        if (!runtime) {
          throw new Error("thread list item runtime unavailable");
        }
        await runtime.delete();
        close();
      } catch (err) {
        console.error("[thread-list] delete failed:", err);
      } finally {
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    [aui, id],
  );

  const handleMove = useCallback(
    async (project: string, close: () => void) => {
      if (movingTo) return;
      setMovingTo(project);
      try {
        let rid = remoteId;
        if (!rid) {
          const initialized = await aui.threads().item({ id }).initialize();
          rid = initialized.remoteId;
        }
        const confirmed = await postThreadProject(rid, project);
        if (confirmed != null) writeCachedThreadProject(rid, confirmed);
        invalidateThreadProjects();
        setView('root');
        close();
      } catch (err) {
        console.error("[thread-list] move-to-project failed:", err);
      } finally {
        setMovingTo(null);
      }
    },
    [aui, id, remoteId, movingTo],
  );

  return (
    <RowMenu
      ariaLabel={t('threadList.moreOptions')}
      closeLabel={t('mention.close')}
      className="opacity-0 pointer-events-none transition-opacity group-hover/thread-item:opacity-100 group-hover/thread-item:pointer-events-auto data-[open=true]:opacity-100 data-[open=true]:pointer-events-auto"
      onOpenChange={(open) => {
        if (!open) setView('root');
      }}
    >
      {(close) =>
        view === 'move' ? (
          <>
            <RowMenuBack label={t('threadList.back')} onClick={() => setView('root')} />
            <RowMenuSection>{t('threadList.moveToProjectHint')}</RowMenuSection>
            {groupedServers.map((server) => (
              <RowMenuItem
                key={server.name}
                label={projectLabel(server.name)}
                disabled={movingTo === server.name || currentProject === server.name}
                onClick={() => {
                  void handleMove(server.name, close);
                }}
              />
            ))}
          </>
        ) : (
          <>
            {groupedServers.length > 0 && (
              <RowMenuItem
                label={t('threadList.moveToProject')}
                description={t('threadList.moveToProjectHint')}
                onClick={() => setView('move')}
              />
            )}
            <RowMenuItem
              label={t('threadList.delete')}
              destructive
              disabled={deleting}
              onClick={() => {
                void handleDelete(close);
              }}
            />
          </>
        )
      }
    </RowMenu>
  );
};

export const ThreadListItem: FC = () => {
  const { t } = useTranslation();
  const activityMap = useContext(ThreadActivityContext);
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId ?? s.threadListItem.id,
  );
  const isMain = useAuiState((s) => s.threads.mainThreadId === s.threadListItem.id);
  const chatRunning = useAuiState((s) => s.thread.isRunning);
  const [, bumpAck] = useState(0);
  useEffect(() => onThreadActivityAckChange(() => bumpAck((n) => n + 1)), []);

  const serverActivity = threadId ? activityMap[threadId] : undefined;
  const effectiveActivity = useMemo((): ThreadActivity | undefined => {
    if (isMain && chatRunning) {
      return { kind: "running", at: new Date().toISOString() };
    }
    return serverActivity;
  }, [isMain, chatRunning, serverActivity]);

  const showBadge =
    threadId &&
    effectiveActivity &&
    shouldShowThreadActivityBadge(threadId, effectiveActivity);

  const ackTerminal = useCallback(() => {
    if (!threadId || !effectiveActivity || effectiveActivity.kind === "running") return;
    ackThreadActivity(threadId, effectiveActivity.at);
  }, [threadId, effectiveActivity]);

  useEffect(() => {
    if (isMain) ackTerminal();
  }, [isMain, ackTerminal]);

  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item group/thread-item hover:bg-muted focus-visible:bg-muted data-active:bg-muted relative flex h-8 items-center gap-1 rounded-md transition-colors focus-visible:outline-none">
      <ThreadListItemPrimitive.Trigger
        className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-start text-sm"
        onClick={ackTerminal}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {showBadge && effectiveActivity ? (
            <ThreadListItemActivityBadge kind={effectiveActivity.kind} />
          ) : null}
        </span>
        <span className="aui-thread-list-item-title min-w-0 truncate">
          <ThreadListItemPrimitive.Title fallback={t('threadList.newChat')} />
        </span>
      </ThreadListItemPrimitive.Trigger>
      <div className="aui-thread-list-item-meta flex shrink-0 items-center gap-1 pe-1.5">
        <ThreadListItemMenu />
        <ThreadListItemTime />
      </div>
    </ThreadListItemPrimitive.Root>
  );
};
