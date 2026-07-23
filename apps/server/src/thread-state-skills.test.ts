import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { resolveScopedMcp } from './mcp-scoping.js';
import {
  createRemoteMcpServer,
  listActiveMcpServerNames,
  listMcpServerGroups,
} from './mcp-store.js';
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

  // Enforcement proof: composes the real store (grouped MCP server rows),
  // real thread-state (project pin), and resolveScopedMcp exactly the way
  // chat.ts's request handler does.
  it('mcpEnabled all-true + a thread pin still yields only the pinned group member', async () => {
    const suffix = Date.now();
    const group = `compass-proj-${suffix}`;
    const pinned = `guolu-${suffix}`;
    const other = `shangzhong-${suffix}`;

    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: pinned,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: other,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });

    const threadId = `thread-scoped-enforcement-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(threadId, pinned);

    // Mirror chat.ts: declaredMcp includes both servers, and the client has
    // mcpEnabled:true for every server (nothing disabled client-side).
    const declaredMcp = [pinned, other];
    const mcpEnabled: Record<string, boolean> = { [pinned]: true, [other]: true };
    const tenantActiveMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const activeMcp = tenantActiveMcp.filter(
      (server) => mcpEnabled == null || mcpEnabled[server] !== false,
    );
    assert.ok(activeMcp.includes(pinned));
    assert.ok(activeMcp.includes(other));

    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;
    assert.equal(pin, pinned);

    const scoped = resolveScopedMcp(activeMcp, groups, pin);

    assert.ok(scoped.active.includes(pinned));
    assert.ok(!scoped.active.includes(other));
    assert.equal(scoped.autoPin, null);
  });

  it('an unpinned thread auto-pins and persists the choice via setProject', async () => {
    const suffix = Date.now() + 1;
    const group = `compass-proj-${suffix}`;
    const alpha = `alpha-${suffix}`;
    const beta = `beta-${suffix}`;

    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: beta,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: alpha,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });

    const threadId = `thread-scoped-autopin-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });

    const declaredMcp = [alpha, beta];
    const activeMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const scoped = resolveScopedMcp(activeMcp, groups, threadState?.project ?? null);

    assert.equal(scoped.autoPin, alpha); // alphabetically first
    assert.ok(scoped.active.includes(alpha));
    assert.ok(!scoped.active.includes(beta));

    await setProject(threadId, scoped.autoPin);
    const hydrated = await getThreadState(threadId);
    assert.equal(hydrated?.project, alpha);
  });
});
