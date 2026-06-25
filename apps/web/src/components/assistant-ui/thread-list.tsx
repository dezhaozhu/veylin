import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArchiveIcon,
  CheckIcon,
  LoaderIcon,
  MinusIcon,
  MoreHorizontalIcon,
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
        className="aui-thread-list-new hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal"
      >
        <PlusIcon className="size-4" />
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
          className="aui-thread-list-skeleton-wrapper flex h-8 items-center px-2.5"
        >
          <Skeleton className="aui-thread-list-skeleton h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
};

const ThreadListItemTime: FC = () => {
  const lastMessageAt = useAuiState((s) => s.threadListItem.lastMessageAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!lastMessageAt) return null;

  return (
    <span className="aui-thread-list-item-time text-muted-foreground w-9 shrink-0 text-right text-xs tabular-nums">
      {formatRelativeTimeShort(lastMessageAt, now)}
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
      <CheckIcon
        className="size-3.5 shrink-0 text-green-600"
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
    <ThreadListItemPrimitive.Root className="aui-thread-list-item group hover:bg-muted focus-visible:bg-muted data-active:bg-muted relative flex h-8 items-center gap-1 rounded-md transition-colors focus-visible:outline-none">
      <ThreadListItemPrimitive.Trigger
        className="aui-thread-list-item-trigger flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-start text-sm"
        onClick={ackTerminal}
      >
        {showBadge && effectiveActivity ? (
          <ThreadListItemActivityBadge kind={effectiveActivity.kind} />
        ) : null}
        <span className="aui-thread-list-item-title min-w-0 truncate">
          <ThreadListItemPrimitive.Title fallback={t('threadList.newChat')} />
        </span>
      </ThreadListItemPrimitive.Trigger>
      <div className="aui-thread-list-item-meta flex shrink-0 items-center gap-1 pe-1.5">
        <ThreadListItemMore />
        <ThreadListItemTime />
      </div>
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemMore: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex w-6 shrink-0 justify-center opacity-0 transition-opacity group-hover:opacity-100 group-data-active:opacity-100 has-[[data-state=open]]:opacity-100">
      <ThreadListItemMorePrimitive.Root>
        <ThreadListItemMorePrimitive.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="aui-thread-list-item-more text-muted-foreground hover:text-foreground size-6 shrink-0 p-0 data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon className="size-3.5" />
            <span className="sr-only">{t('threadList.moreOptions')}</span>
          </Button>
        </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="right"
        align="start"
        sideOffset={6}
        className="aui-thread-list-item-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
      >
        <ThreadListItemPrimitive.Archive asChild>
          <ThreadListItemMorePrimitive.Item className="aui-thread-list-item-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
            <ArchiveIcon className="size-4" />
            {t('threadList.archive')}
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Archive>
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item className="aui-thread-list-item-more-item text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
            <TrashIcon className="size-4" />
            {t('threadList.delete')}
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
      </ThreadListItemMorePrimitive.Root>
    </div>
  );
};
