import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveEnterWhileRunning } from './composer-submit-keys';

describe('composer-submit-keys', () => {
  it('resolveEnterWhileRunning queues only while running with draft text', () => {
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
});
