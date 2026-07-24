import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recallOrEmpty } from './memory-recall.js';

test('recallOrEmpty returns empty messages for missing threads (fresh conversation)', async () => {
  const memory = {
    recall: async () => {
      throw new Error('No thread found with id __LOCALID_x');
    },
  } as never;
  const out = await recallOrEmpty(memory, { threadId: 't', perPage: false } as never);
  assert.deepEqual(out.messages, []);
});

test('recallOrEmpty passes through results and rethrows other errors', async () => {
  const ok = { recall: async () => ({ messages: [{ id: 'm1' }] }) } as never;
  const out = await recallOrEmpty(ok, { threadId: 't' } as never);
  assert.equal(out.messages.length, 1);

  const boom = { recall: async () => { throw new Error('disk on fire'); } } as never;
  await assert.rejects(() => recallOrEmpty(boom, { threadId: 't' } as never), /disk on fire/);
});
