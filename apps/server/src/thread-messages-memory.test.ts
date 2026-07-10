import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMemoryStoreFailure } from './thread-sync.js';

describe('thread messages memory failure contract', () => {
  it('detects datastore failures that must map to 503 not empty messages', () => {
    assert.equal(
      isMemoryStoreFailure(new Error('GenericFailure: Invalid revision')),
      true,
    );
    assert.equal(isMemoryStoreFailure(new Error('random')), false);
  });
});
