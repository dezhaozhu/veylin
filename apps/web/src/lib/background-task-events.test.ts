import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  fetchBackgroundTaskSnapshot,
  subscribeBackgroundTaskEvents,
} from './background-task-events';

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
});

describe('background-task-events', () => {
  it('fetches task snapshots with batch ids and credentials', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ tasks: [{ id: 't1', status: 'running' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const snapshot = await fetchBackgroundTaskSnapshot('thread-1', ['t1', 't2']);

    assert.equal(snapshot?.tasks?.[0]?.id, 't1');
    assert.equal(calls[0]?.url, '/api/tasks?threadId=thread-1&batchIds=t1%2Ct2');
    assert.equal(calls[0]?.init?.credentials, 'include');
  });

  it('subscribes to task SSE events with credentials', () => {
    const listeners = new Map<string, (event: MessageEvent<string>) => void>();
    let closed = false;
    let createdUrl = '';
    let withCredentials = false;

    class FakeEventSource {
      onerror: (() => void) | null = null;

      constructor(url: string, init?: EventSourceInit) {
        createdUrl = url;
        withCredentials = Boolean(init?.withCredentials);
      }

      addEventListener(event: string, listener: EventListener) {
        listeners.set(event, listener as (event: MessageEvent<string>) => void);
      }

      close() {
        closed = true;
      }
    }

    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

    const seen: unknown[] = [];
    const unsubscribe = subscribeBackgroundTaskEvents('thread-1', (snapshot) => {
      seen.push(snapshot);
    });
    listeners.get('task.updated')?.(
      new MessageEvent('task.updated', {
        data: JSON.stringify({ tasks: [{ id: 't1', status: 'done' }] }),
      }),
    );
    unsubscribe();

    assert.equal(createdUrl, '/api/tasks/events?threadId=thread-1');
    assert.equal(withCredentials, true);
    assert.deepEqual(seen, [{ tasks: [{ id: 't1', status: 'done' }] }]);
    assert.equal(closed, true);
  });
});

