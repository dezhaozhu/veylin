import { getTaskRow, listTasksByParentThread, updateTaskRow } from '@veylin/db';
import { SUBAGENT_QUEUE, type QueuePort } from './queue';
import { publishTaskEvent } from './task-events';
import { clearTaskProgress } from './task-progress-store';

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

/**
 * Cancel all non-terminal subagent tasks for a parent chat thread.
 * Used when the user hits Stop (Claude Code parent-abort / kill-agents cascade).
 */
export async function cancelThreadSubagentTasks(
  threadId: string,
  queue: QueuePort,
): Promise<{ cancelled: string[] }> {
  const rows = await listTasksByParentThread(threadId).catch(() => []);
  const cancelled: string[] = [];

  for (const row of rows) {
    if (TERMINAL.has(row.status)) continue;
    await updateTaskRow(row.id, { status: 'cancelled' }).catch(() => undefined);
    if (row.jobId) {
      await queue.cancel(SUBAGENT_QUEUE, row.jobId).catch(() => undefined);
    }
    clearTaskProgress(row.id);
    publishTaskEvent({ kind: 'task.updated', threadId, taskId: row.id });
    cancelled.push(row.id);
  }

  return { cancelled };
}

/** Cancel a single task (shared by task_stop tool and status-bar stop). */
export async function cancelSubagentTask(
  taskId: string,
  queue: QueuePort,
): Promise<{ ok: boolean; status: string }> {
  const row = await getTaskRow(taskId);
  if (!row) return { ok: false, status: 'unknown' };
  if (TERMINAL.has(row.status)) return { ok: false, status: row.status };

  await updateTaskRow(taskId, { status: 'cancelled' });
  if (row.jobId) {
    await queue.cancel(SUBAGENT_QUEUE, row.jobId).catch(() => undefined);
  }
  clearTaskProgress(taskId);
  if (row.parentThreadId) {
    publishTaskEvent({ kind: 'task.updated', threadId: row.parentThreadId, taskId: row.id });
  }
  return { ok: true, status: 'cancelled' };
}
