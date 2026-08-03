import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearHistoryLoadError,
  getHistoryLoadState,
  setHistoryLoadError,
  setHistoryLoadRetry,
  retryHistoryLoad,
} from './history-load-state.js';

describe('history-load-state', () => {
  it('stores and clears load errors per remoteId', () => {
    clearHistoryLoadError();
    setHistoryLoadError('t1', 'boom');
    assert.deepEqual(getHistoryLoadState(), { remoteId: 't1', error: 'boom' });
    clearHistoryLoadError('t2');
    assert.equal(getHistoryLoadState().error, 'boom');
    clearHistoryLoadError('t1');
    assert.equal(getHistoryLoadState().error, null);
  });

  it('invokes registered retry handler', () => {
    let calls = 0;
    setHistoryLoadRetry(() => {
      calls += 1;
    });
    retryHistoryLoad();
    assert.equal(calls, 1);
    setHistoryLoadRetry(null);
  });
});
