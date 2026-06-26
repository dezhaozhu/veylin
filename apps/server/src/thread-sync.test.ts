import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldReplaceFromClient } from './thread-sync';

describe('shouldReplaceFromClient', () => {
  it('syncs first client message into empty store', () => {
    assert.equal(
      shouldReplaceFromClient([], [{ id: 'u1', role: 'user', parts: [{ type: 'file' }] }]),
      true,
    );
  });

  it('syncs when client appends a new message', () => {
    assert.equal(
      shouldReplaceFromClient(
        [{ id: 'u1', role: 'user' }],
        [
          { id: 'u1', role: 'user' },
          { id: 'a1', role: 'assistant' },
          { id: 'u2', role: 'user', parts: [{ type: 'file' }, { type: 'file' }] },
        ],
      ),
      true,
    );
  });

  it('syncs when client history diverges from store', () => {
    assert.equal(
      shouldReplaceFromClient(
        [{ id: 'u1', role: 'user' }],
        [{ id: 'u9', role: 'user' }],
      ),
      true,
    );
  });
});
