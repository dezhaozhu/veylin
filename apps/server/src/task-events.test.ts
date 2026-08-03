import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publishTaskEvent, subscribeTaskEvents } from './task-events';

describe('task-events', () => {
  it('publishes events only to matching thread subscribers', () => {
    const seen: string[] = [];
    const unsubscribeA = subscribeTaskEvents('thread-a', (event) => {
      seen.push(`${event.threadId}:${event.kind}:${event.taskId ?? ''}`);
    });
    const unsubscribeB = subscribeTaskEvents('thread-b', (event) => {
      seen.push(`${event.threadId}:${event.kind}:${event.taskId ?? ''}`);
    });

    publishTaskEvent({ kind: 'task.updated', threadId: 'thread-a', taskId: 't1' });
    unsubscribeA();
    publishTaskEvent({ kind: 'task.updated', threadId: 'thread-a', taskId: 't2' });
    publishTaskEvent({ kind: 'batch.readiness', threadId: 'thread-b', taskId: 't3' });
    unsubscribeB();

    assert.deepEqual(seen, [
      'thread-a:task.updated:t1',
      'thread-b:batch.readiness:t3',
    ]);
  });
});

