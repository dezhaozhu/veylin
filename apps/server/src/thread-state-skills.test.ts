import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { ensureThreadState, getThreadState, mergeActivatedSkillContents, setProject } from './thread-state.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

describe('mergeActivatedSkillContents', () => {
  it('overwrites activated bodies when disk content changed', () => {
    const { next, changed } = mergeActivatedSkillContents(
      { alpha: 'old body', beta: 'same' },
      { alpha: 'new body', beta: 'same' },
    );
    assert.equal(changed, true);
    assert.deepEqual(next, { alpha: 'new body', beta: 'same' });
  });

  it('keeps prior text when skill is missing from catalog', () => {
    const { next, changed } = mergeActivatedSkillContents(
      { gone: 'still useful' },
      { gone: null },
    );
    assert.equal(changed, false);
    assert.deepEqual(next, { gone: 'still useful' });
  });

  it('reports no change when contents match', () => {
    const { next, changed } = mergeActivatedSkillContents(
      { alpha: 'body' },
      { alpha: 'body' },
    );
    assert.equal(changed, false);
    assert.deepEqual(next, { alpha: 'body' });
  });
});

describe('thread project pin', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('defaults to null on a freshly ensured thread', async () => {
    const threadId = `thread-project-default-${Date.now()}`;
    const state = await ensureThreadState({
      threadId,
      tenantId: DEV_TENANT_ID,
      resourceId: 'dev-user',
    });
    assert.equal(state.project, null);
  });

  it('setProject persists and hydrates', async () => {
    const threadId = `thread-project-set-${Date.now()}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });

    await setProject(threadId, 'compass-guolu');

    const hydrated = await getThreadState(threadId);
    assert.equal(hydrated?.project, 'compass-guolu');
  });

  it('setProject(null) clears it', async () => {
    const threadId = `thread-project-clear-${Date.now()}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(threadId, 'compass-guolu');

    await setProject(threadId, null);

    const hydrated = await getThreadState(threadId);
    assert.equal(hydrated?.project, null);
  });
});
