/**
 * Regression test for the working-memory resource→thread scope fix
 * (packages/runtime/src/memory.ts `buildMemoryOptions`).
 *
 * Before the fix, `workingMemory.scope: 'resource'` meant `getWorkingMemory`
 * read/wrote a single blob keyed by `resourceId` — shared by every thread the
 * same user has open, regardless of which project each thread is pinned to.
 * `thread-state.syncWorkingMemory`'s null-fallback
 * (`storedWorkingMemory ?? memory.getWorkingMemory(...)`) meant a *fresh*
 * thread with no working memory of its own would silently inherit whatever
 * another thread on the same resource last wrote — the concrete leak this
 * closes: a fact seeded into thread-2 must never surface when thread-1 (same
 * resource, no stored working memory yet) syncs.
 *
 * This exercises the real `@mastra/memory` `Memory` class (via
 * `@veylin/runtime`'s `buildMemory`) against a throwaway LibSQL file — no
 * embedder needed, working memory doesn't require one.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, connectDb } from '@veylin/db';
import { buildMemory } from '@veylin/runtime';
import { syncWorkingMemory, ensureThreadState } from './thread-state.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

describe('working memory: thread-1 must not see thread-2\'s seeded blob (same resource)', () => {
  let dataDir: string;
  let memory: ReturnType<typeof buildMemory>;

  before(async () => {
    await connectDb();
    await ensureDevTenant();
    dataDir = await mkdtemp(join(tmpdir(), 'veylin-memory-scope-'));
    memory = buildMemory(`file:${join(dataDir, 'mastra-memory.db')}`);
  });

  after(async () => {
    await closeDb();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('thread-1\'s syncWorkingMemory fallback does not return thread-2\'s seeded blob', async () => {
    const resourceId = `dev-user-${Date.now()}`;
    const thread1 = `thread-scope-1-${Date.now()}`;
    const thread2 = `thread-scope-2-${Date.now()}`;
    const identity1 = { threadId: thread1, tenantId: DEV_TENANT_ID, resourceId };
    const identity2 = { threadId: thread2, tenantId: DEV_TENANT_ID, resourceId };

    await ensureThreadState(identity1);
    await ensureThreadState(identity2);

    // Both threads must exist in the mastra memory store before working
    // memory can be written/read against them (thread-scoped storage keys
    // off the thread record, not just threadId).
    await memory.createThread({ threadId: thread1, resourceId, title: 't1' });
    await memory.createThread({ threadId: thread2, resourceId, title: 't2' });

    const secretToken = `SECRET-ONLY-IN-THREAD-2-${Date.now()}`;
    await memory.updateWorkingMemory({
      threadId: thread2,
      resourceId,
      workingMemory: `## Notes\n- ${secretToken}\n`,
    });

    // Sanity: thread-2 really did store it (proves the seed worked and isn't
    // itself broken by the scope change).
    const thread2Read = await memory.getWorkingMemory({ threadId: thread2, resourceId });
    assert.match(thread2Read ?? '', new RegExp(secretToken));

    // The regression: thread-1 has no working memory of its own yet.
    // syncWorkingMemory's null-fallback (storedWorkingMemory=null) must NOT
    // surface thread-2's blob just because they share a resourceId.
    await syncWorkingMemory(memory, identity1, {}, null);

    const thread1Read = await memory.getWorkingMemory({ threadId: thread1, resourceId });
    assert.equal(
      thread1Read?.includes(secretToken) ?? false,
      false,
      'thread-1 working memory must not contain a token only ever written to thread-2',
    );
  });
});
