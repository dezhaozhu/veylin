import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearPendingQuote,
  getPendingQuote,
  quoteThreadIds,
  resetPendingQuotesForTests,
  setPendingQuote,
} from './pending-quote';

describe('pending-quote', () => {
  it('keeps quotes isolated per thread', () => {
    resetPendingQuotesForTests();
    setPendingQuote(['thread-a'], '看下迟到订单清单？');
    setPendingQuote(['thread-b'], '拉一版甘特图');
    assert.equal(getPendingQuote(['thread-a']), '看下迟到订单清单？');
    assert.equal(getPendingQuote(['thread-b']), '拉一版甘特图');
    assert.equal(getPendingQuote(['thread-c']), null);
  });

  it('reads the same quote from local or remote id', () => {
    resetPendingQuotesForTests();
    setPendingQuote(['local-1', 'remote-1'], '补充完整数据');
    assert.equal(getPendingQuote(['remote-1']), '补充完整数据');
    assert.equal(getPendingQuote(['local-1']), '补充完整数据');
  });

  it('clears only the given thread', () => {
    resetPendingQuotesForTests();
    setPendingQuote(['thread-a'], 'A');
    setPendingQuote(['thread-b'], 'B');
    clearPendingQuote(['thread-a']);
    assert.equal(getPendingQuote(['thread-a']), null);
    assert.equal(getPendingQuote(['thread-b']), 'B');
  });

  it('collects local and remote ids', () => {
    assert.deepEqual(
      quoteThreadIds({ id: 'local', remoteId: 'remote', externalId: 'remote' }),
      ['local', 'remote'],
    );
  });
});
