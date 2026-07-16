import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPersistableThreadId } from './sync-thread-messages';

describe('isPersistableThreadId', () => {
  it('accepts real remote thread ids', () => {
    assert.equal(isPersistableThreadId('thread-abc'), true);
    assert.equal(isPersistableThreadId('  remote_1  '), true);
  });

  it('rejects empty and assistant-ui local placeholders', () => {
    assert.equal(isPersistableThreadId(undefined), false);
    assert.equal(isPersistableThreadId(''), false);
    assert.equal(isPersistableThreadId('   '), false);
    assert.equal(isPersistableThreadId('__LOCALID_XrLZNww'), false);
  });
});
