import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMemoryOptions } from './memory.js';

/**
 * Locked-config regression test for the resource→thread scope fix.
 *
 * The leak class this guards against: `scope: 'resource'` shares
 * working-memory / semantic-recall state across every thread that happens to
 * share a resourceId — which in this app means every thread belonging to the
 * same user, regardless of which project/tenant it's pinned to. That let one
 * project's data leak into another project's thread (working memory via the
 * null-fallback seed in `thread-state.syncWorkingMemory` / `dream-service`;
 * semantic recall via subagent/workflow `agent.generate({ memory })`
 * auto-recall). `scope: 'thread'` confines both to the single thread.
 */
describe('buildMemoryOptions — thread-scoped memory, not resource-scoped', () => {
  it('workingMemory.scope is "thread" (unconditional — WM has no on/off gate here)', () => {
    const opts = buildMemoryOptions({ lastMessages: 12, recallEnabled: false });
    assert.equal(opts.workingMemory.scope, 'thread');
  });

  it('workingMemory.scope stays "thread" regardless of recallEnabled', () => {
    const opts = buildMemoryOptions({ lastMessages: 12, recallEnabled: true });
    assert.equal(opts.workingMemory.scope, 'thread');
  });

  it('semanticRecall.scope is "thread" when recall is enabled', () => {
    const opts = buildMemoryOptions({ lastMessages: 12, recallEnabled: true });
    assert.notEqual(opts.semanticRecall, false);
    if (opts.semanticRecall === false) return; // unreachable, narrows for TS
    assert.equal(opts.semanticRecall.scope, 'thread');
  });

  it('semanticRecall is false (not just scoped differently) when recall is disabled', () => {
    const opts = buildMemoryOptions({ lastMessages: 12, recallEnabled: false });
    assert.equal(opts.semanticRecall, false);
  });
});
