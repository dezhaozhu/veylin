import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AuiIf, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type FC,
} from "react";
import { useTranslation } from "react-i18next";
import { onThreadActivityAckChange } from "@/lib/thread-activity-ack";
import { useThreadActivityMap } from "@/lib/use-thread-activity";
import { useGroupedMcpServers, type McpGroupMember } from "@/lib/mcp-groups-sync";
import { useThreadProjects } from "@/lib/thread-projects-sync";
import {
  ThreadActivityContext,
  ThreadListItem,
} from "@/components/assistant-ui/thread-list-item";
import { ProjectsSection, type ProjectBucket } from "@/components/assistant-ui/project-list";

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

/** Partition every threadId into per-project buckets (threads pinned to a
 * grouped MCP server, "project") plus the remaining/unpinned indices. When
 * the tenant has no grouped servers, every index is "remaining" and behavior
 * is byte-identical to the pre-Projects sidebar. */
function partitionByProject(
  threadIds: readonly string[],
  itemsById: Map<string, { remoteId: string | undefined; lastMessageAt?: Date | undefined }>,
  groupedServers: McpGroupMember[],
  threadProjects: Record<string, string>,
): { buckets: ProjectBucket[]; remainingIndices: number[] } {
  if (groupedServers.length === 0) {
    return { buckets: [], remainingIndices: threadIds.map((_, index) => index) };
  }

  const time = (index: number) =>
    itemsById.get(threadIds[index]!)?.lastMessageAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

  const byProject = new Map<string, number[]>(groupedServers.map((s) => [s.name, []]));
  const remaining: number[] = [];
  threadIds.forEach((id, index) => {
    const remoteId = itemsById.get(id)?.remoteId;
    const project = remoteId ? threadProjects[remoteId] : undefined;
    const bucket = project ? byProject.get(project) : undefined;
    if (bucket) bucket.push(index);
    else remaining.push(index);
  });

  for (const indices of byProject.values()) indices.sort((a, b) => time(b) - time(a));
  remaining.sort((a, b) => time(b) - time(a));

  const buckets = groupedServers.map((s) => ({ name: s.name, indices: byProject.get(s.name) ?? [] }));
  return { buckets, remainingIndices: remaining };
}

const ThreadListItems: FC = () => {
  const { t, i18n } = useTranslation();
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const groupedServers = useGroupedMcpServers();
  const threadProjects = useThreadProjects();
  const hasProjects = groupedServers.length > 0;

  const itemsById = useMemo(
    () => new Map(threadItems.map((item) => [item.id, item])),
    [threadItems],
  );

  const { buckets, remainingIndices } = useMemo(
    () => partitionByProject(threadIds, itemsById, groupedServers, threadProjects),
    [threadIds, itemsById, groupedServers, threadProjects],
  );

  const groups = useMemo<ThreadListGroup[] | null>(() => {
    const dates = remainingIndices.map((index) => itemsById.get(threadIds[index]!)?.lastMessageAt);
    if (!dates.some(Boolean)) return null;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const time = (pos: number) => dates[pos]?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const order = dates.map((_, pos) => pos).sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const pos of order) {
      const index = remainingIndices[pos]!;
      const label = t(`threadList.${dateGroupKey(dates[pos], startOfToday)}`);
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return result;
  }, [remainingIndices, threadIds, itemsById, t, i18n.language]);

  return (
    <>
      {hasProjects && <ProjectsSection buckets={buckets} threadIds={threadIds} />}
      {hasProjects && remainingIndices.length > 0 && (
        <div className="aui-thread-list-group-label text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">
          {t('threadList.recent')}
        </div>
      )}
      {!hasProjects && !groups ? (
        <ThreadListPrimitive.Items>
          {() => <ThreadListItem />}
        </ThreadListPrimitive.Items>
      ) : groups ? (
        groups.map((group) => (
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
        ))
      ) : hasProjects ? (
        remainingIndices.map((index) => (
          <ThreadListPrimitive.ItemByIndex
            key={threadIds[index]}
            index={index}
            components={{ ThreadListItem }}
          />
        ))
      ) : null}
    </>
  );
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
