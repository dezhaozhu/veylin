import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskRow } from '@veylin/db';
import { awaitTaskCompletion } from './agent-task-runner';
import { publishTaskEvent } from './task-events';

function makeRow(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: 'task-1',
    tenantId: 't',
    status: 'running',
    agentId: 'a',
    prompt: 'p',
    ...overrides,
  } as TaskRow;
}

describe('awaitTaskCompletion (synchronous Task model)', () => {
  it('returns immediately when the row is already terminal', async () => {
    const row = makeRow({ status: 'done', result: 'final' });
    const result = await awaitTaskCompletion({
      taskId: 'task-1',
      getRow: async () => row,
    });
    assert.equal(result?.status, 'done');
    assert.equal(result?.result, 'final');
  });

  it('resolves on a task-event wakeup once the worker finishes', async () => {
    let status: TaskRow['status'] = 'running';
    const parentThreadId = 'thread-await-1';

    const promise = awaitTaskCompletion({
      taskId: 'task-1',
      parentThreadId,
      // Long poll interval so we know the event drove resolution, not polling.
      pollIntervalMs: 100_000,
      getRow: async () => makeRow({ status, result: 'worker output' }),
    });

    // Flip to done then wake the waiter via the task-event bus.
    setTimeout(() => {
      status = 'done';
      publishTaskEvent({ kind: 'task.updated', threadId: parentThreadId, taskId: 'task-1' });
    }, 20);

    const result = await promise;
    assert.equal(result?.status, 'done');
    assert.equal(result?.result, 'worker output');
  });

  it('falls back to DB polling when no event arrives', async () => {
    let status: TaskRow['status'] = 'running';
    setTimeout(() => {
      status = 'failed';
    }, 30);

    const result = await awaitTaskCompletion({
      taskId: 'task-1',
      pollIntervalMs: 10,
      getRow: async () => makeRow({ status, result: 'boom' }),
    });
    assert.equal(result?.status, 'failed');
  });

  it('resolves null when the parent stream aborts', async () => {
    const controller = new AbortController();
    const promise = awaitTaskCompletion({
      taskId: 'task-1',
      abortSignal: controller.signal,
      pollIntervalMs: 100_000,
      getRow: async () => makeRow({ status: 'running' }),
    });
    setTimeout(() => controller.abort(), 10);
    const result = await promise;
    assert.equal(result, null);
  });
});
