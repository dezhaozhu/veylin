import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuiIf,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  LoaderIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTimeShort } from "@/lib/format-relative-time";
import {
  ackThreadActivity,
  shouldShowThreadActivityBadge,
  onThreadActivityAckChange,
} from "@/lib/thread-activity-ack";
import {
  useThreadActivityMap,
  type ThreadActivity,
} from "@/lib/use-thread-activity";

const ThreadActivityContext = createContext<Record<string, ThreadActivity>>({});

export const ThreadList: FC = () => {
  const activity = useThreadActivityMap();
  const [, bumpAck] = useState(0);
  useEffect(() => onThreadActivityAckChange(() => bumpAck((n) => n + 1)), []);

  return (
    <ThreadActivityContext.Provider value={activity}>
      <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col gap-0.5">
        <ThreadListNew />
        <AuiIf condition={(s) => s.threads.isLoading}>
          <ThreadListSkeleton />
        </AuiIf>
        <AuiIf condition={(s) => !s.threads.isLoading}>
          <ThreadListItems />
        </AuiIf>
      </ThreadListPrimitive.Root>
    </ThreadActivityContext.Provider>
  );
};

const DAY_IN_MS = 86_400_000;

type DateGroupKey = 'today' | 'yesterday' | 'earlier';

const dateGroupKey = (
  date: Date | undefined,
  startOfToday: number,
): DateGroupKey => {
  if (!date || date.getTime() >= startOfToday) return 'today';
  if (date.getTime() >= startOfToday - DAY_IN_MS) return 'yesterday';
  return 'earlier';
};

type ThreadListGroup = { label: string; indices: number[] };

const ThreadListItems: FC = () => {
  const { t, i18n } = useTranslation();
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  const groups = useMemo<ThreadListGroup[] | null>(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
    if (!dates.some(Boolean)) return null;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const time = (index: number) =>
      dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const indices = threadIds
      .map((_, index) => index)
      .sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const index of indices) {
      const label = t(`threadList.${dateGroupKey(dates[index], startOfToday)}`);
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return result;
  }, [threadIds, threadItems, t, i18n.language]);

  if (!groups) {
    return (
      <ThreadListPrimitive.Items>
        {() => <ThreadListItem />}
      </ThreadListPrimitive.Items>
    );
  }

  return groups.map((group) => (
    <Fragment key={group.label}>
      <div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
        {group.label}
      </div>
      {group.indices.map((index) => (
        <ThreadListPrimitive.ItemByIndex
          key={threadIds[index]}
          index={index}
          components={{ ThreadListItem }}
        />
      ))}
    </Fragment>
  ));
};

const ThreadListNew: FC = () => {
  const { t } = useTranslation();
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        variant="ghost"
        size="sm"
        className="aui-thread-list-new hover:bg-muted data-active:bg-muted h-8 w-full justify-start gap-2 rounded-md p-2 text-sm font-normal"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <PlusIcon className="size-4" />
        </span>
        {t('threadList.newChat')}
      </Button>
    </ThreadListPrimitive.New>
  );
};

const ThreadListSkeleton: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label={t('threadList.loading')}
          className="aui-thread-list-skeleton-wrapper flex h-8 items-center gap-2 px-2"
        >
          <span className="size-4 shrink-0" aria-hidden />
          <Skeleton className="aui-thread-list-skeleton h-3.5 min-w-0 flex-1" />
        </div>
      ))}
    </div>
  );
};

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

const ThreadListItem: FC = () => {
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
        <ThreadListItemDelete />
        <ThreadListItemTime />
      </div>
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemDelete: FC = () => {
  const { t } = useTranslation();
  const aui = useAui();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  const handleDelete = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (deletingRef.current) return;

      deletingRef.current = true;
      setDeleting(true);
      try {
        const runtime = aui
          .threads()
          .item({ id: threadId })
          .__internal_getRuntime?.();
        if (!runtime) {
          throw new Error("thread list item runtime unavailable");
        }
        await runtime.delete();
      } catch (err) {
        console.error("[thread-list] delete failed:", err);
      } finally {
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    [aui, threadId],
  );

  return (
    <div className="relative z-10 flex w-6 shrink-0 justify-center opacity-0 pointer-events-none transition-opacity group-hover/thread-item:opacity-100 group-hover/thread-item:pointer-events-auto">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={deleting}
        className="aui-thread-list-item-delete text-muted-foreground hover:bg-destructive/10 hover:text-destructive size-6 shrink-0 p-0"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={handleDelete}
      >
        {deleting ? (
          <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <TrashIcon className="size-3.5" aria-hidden />
        )}
        <span className="sr-only">{t("threadList.delete")}</span>
      </Button>
    </div>
  );
};
