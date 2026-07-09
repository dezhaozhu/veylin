import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  abortAllReadOpenPageReads,
  clearReadOpenPageSubmitted,
  executeReadOpenPageForToolCall,
  isReadOpenPageSubmitted,
  markReadOpenPageSubmitted,
  registerReadOpenPageResultSubmitter,
  submitReadOpenPageResult,
} from './read-open-page-submit-bridge';

describe('read-open-page-submit-bridge', () => {
  beforeEach(() => {
    clearReadOpenPageSubmitted();
    abortAllReadOpenPageReads();
    registerReadOpenPageResultSubmitter('thread-1', null);
  });

  it('routes submit to the thread-scoped submitter', async () => {
    const seen: Array<{ id: string; error?: string }> = [];
    registerReadOpenPageResultSubmitter('thread-1', (toolCallId, result) => {
      seen.push({ id: toolCallId, error: result.error });
    });

    const ok = await submitReadOpenPageResult('thread-1', 'call-1', {
      mode: 'text',
      error: 'boom',
    }, { isError: true });

    assert.equal(ok, true);
    assert.equal(isReadOpenPageSubmitted('call-1'), true);
    assert.deepEqual(seen, [{ id: 'call-1', error: 'boom' }]);
  });

  it('returns false when no submitter is registered', async () => {
    const ok = await submitReadOpenPageResult('missing', 'call-2', {
      mode: 'text',
      content: 'x',
    });
    assert.equal(ok, false);
    assert.equal(isReadOpenPageSubmitted('call-2'), true);
  });

  it('skips execute when already submitted', async () => {
    markReadOpenPageSubmitted('call-3');
    const result = await executeReadOpenPageForToolCall({
      threadId: 'thread-1',
      toolCallId: 'call-3',
    });
    assert.equal(result, null);
  });
});
