import type { Memory } from '@mastra/memory';
import { queryRows, getDb } from '@veylin/db';
import { getActiveStreamId } from './resumable-chat-stream';
import { listThreadsForResource } from './thread-state';

export type ThreadActivityKind = 'running' | 'finished' | 'interrupted';

export type ThreadActivity = {
  kind: ThreadActivityKind;
  at: string;
};

const TERMINAL_TASK: Record<string, ThreadActivityKind> = {
  done: 'finished',
  failed: 'interrupted',
  cancelled: 'interrupted',
};

const ACTIVE_TASK = new Set(['queued', 'running']);

export async function listThreadActivity(
  tenantId: string,
  resourceId: string,
  memory: Memory,
): Promise<Record<string, ThreadActivity>> {
  const threads = await listThreadsForResource(tenantId, resourceId, memory);
  const threadIds = threads.map((t) => t.remoteId);
  if (threadIds.length === 0) return {};

  const taskRows = await queryRows<{
    parent_thread_id?: string;
    status?: string;
    updated_at?: string;
  }>(
    getDb(),
    'SELECT parent_thread_id, status, updated_at FROM task WHERE tenant_id = $tenantId AND parent_thread_id IN $threadIds ORDER BY updated_at DESC',
    { tenantId, threadIds },
  );

  const latestTaskByThread = new Map<string, { status: string; updatedAt: string }>();
  for (const row of taskRows) {
    const tid = row.parent_thread_id;
    if (!tid || latestTaskByThread.has(tid)) continue;
    latestTaskByThread.set(tid, {
      status: String(row.status ?? ''),
      updatedAt: String(row.updated_at ?? new Date().toISOString()),
    });
  }

  const out: Record<string, ThreadActivity> = {};
  await Promise.all(
    threadIds.map(async (threadId) => {
      const activeStream = await getActiveStreamId(threadId);
      if (activeStream) {
        out[threadId] = { kind: 'running', at: new Date().toISOString() };
        return;
      }

      const task = latestTaskByThread.get(threadId);
      if (!task) return;

      if (ACTIVE_TASK.has(task.status)) {
        out[threadId] = { kind: 'running', at: task.updatedAt };
        return;
      }

      const kind = TERMINAL_TASK[task.status];
      if (kind) {
        out[threadId] = { kind, at: task.updatedAt };
      }
    }),
  );

  return out;
}
