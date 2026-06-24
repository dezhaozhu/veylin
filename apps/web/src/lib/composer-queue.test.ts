import assert from 'node:assert/strict';
import test from 'node:test';
import { createMessageQueueWithDrafts } from './create-message-queue-with-drafts';
import type { AppendMessage } from '@assistant-ui/core';
import {
  resolveEnterWhileRunning,
  shouldInterceptTabForQueue,
} from './composer-submit-keys';

const msg = (text: string): AppendMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
  attachments: [],
  createdAt: new Date(0),
  parentId: null,
  sourceId: null,
  runConfig: {},
  metadata: { custom: {} },
});

test('createMessageQueueWithDrafts popQueuedMessage returns draft and removes item', () => {
  let running = false;
  const run = () => {
    running = true;
  };
  const { adapter, notifyIdle, popQueuedMessage } =
    createMessageQueueWithDrafts({ run });

  adapter.enqueue(msg('first'), { steer: false });
  assert.equal(running, true);
  adapter.enqueue(msg('queued'), { steer: false });
  assert.equal(adapter.items.length, 1);

  const popped = popQueuedMessage(adapter.items[0]!.id);
  assert.equal(
    popped?.content[0]?.type === 'text'
      ? (popped.content[0] as { text: string }).text
      : '',
    'queued',
  );
  assert.equal(adapter.items.length, 0);

  notifyIdle();
});

test('createMessageQueueWithDrafts snapshots prompts on cancel-run clear', () => {
  const run = () => {};
  const { adapter, notifyBusy, takeCancelRestorePrompts } =
    createMessageQueueWithDrafts({ run });

  notifyBusy();
  adapter.enqueue(msg('a'), { steer: false });
  adapter.enqueue(msg('b'), { steer: false });
  assert.equal(adapter.items.length, 2);
  adapter.clear('cancel-run');
  assert.deepEqual(takeCancelRestorePrompts(), ['a', 'b']);
  assert.deepEqual(takeCancelRestorePrompts(), []);
});

test('resolveEnterWhileRunning always queues while running', () => {
  assert.equal(
    resolveEnterWhileRunning({
      isRunning: true,
      canQueue: true,
      composerEmpty: false,
    }),
    'queue',
  );
  assert.equal(
    resolveEnterWhileRunning({
      isRunning: false,
      canQueue: true,
      composerEmpty: false,
    }),
    'ignore',
  );
  assert.equal(
    resolveEnterWhileRunning({
      isRunning: true,
      canQueue: true,
      composerEmpty: true,
    }),
    'ignore',
  );
});

test('shouldInterceptTabForQueue only when running with draft text', () => {
  assert.equal(
    shouldInterceptTabForQueue({
      isRunning: true,
      canQueue: true,
      composerEmpty: false,
    }),
    true,
  );
  assert.equal(
    shouldInterceptTabForQueue({
      isRunning: true,
      canQueue: true,
      composerEmpty: true,
    }),
    false,
  );
});

