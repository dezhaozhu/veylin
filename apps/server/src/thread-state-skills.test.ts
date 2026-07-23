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

  // CRITICAL-finding regression: scoping must run against server-truth active
  // servers, never the client-mcpEnabled-filtered list — composes the real
  // store + thread-state + resolveScopedMcp exactly as chat.ts's post-fix
  // request handler does, including the persistence gate (pin unchanged).
  it('client mcpEnabled cannot evict the pinned server from scoping, and the stored pin is not rewritten', async () => {
    const suffix = Date.now() + 2;
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

    const threadId = `thread-scoped-attack-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(threadId, pinned);

    // Attack: the client claims the pinned server is disabled and the other
    // group member is enabled.
    const declaredMcp = [pinned, other];
    const mcpEnabled: Record<string, boolean> = { [pinned]: false, [other]: true };

    // chat.ts (post-fix): scoping runs against server-truth tenantActiveMcp,
    // never the client-filtered list.
    const tenantActiveMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;
    assert.equal(pin, pinned);

    const scoped = resolveScopedMcp(tenantActiveMcp, groups, pin);
    // Pin was valid against server truth — no re-pin needed.
    assert.equal(scoped.autoPin, null);
    if (pin == null && scoped.autoPin) {
      await setProject(threadId, scoped.autoPin);
    }
    const activeMcp = scoped.active.filter(
      (server) => groups[server] != null || mcpEnabled == null || mcpEnabled[server] !== false,
    );

    // The request still scopes to the pinned server despite the client's toggle.
    assert.ok(activeMcp.includes(pinned));
    assert.ok(!activeMcp.includes(other));

    // The stored pin is unchanged — no silent rewrite was persisted.
    const hydrated = await getThreadState(threadId);
    assert.equal(hydrated?.project, pinned);
  });

  // Regression for the subagent-allowlist/client-toggle conflation: baseline
  // handed a dispatched subagent its preset's full declared MCP list
  // regardless of client mcpEnabled toggles. chat.ts's `scopedMcpServers`
  // (read by scopedMcpServersFromCtx for subagent dispatch, see
  // agent-task-runner.ts) must reflect only the project pin — computed from
  // `resolveScopedMcp` on server-truth active servers — never the additional
  // client-mcpEnabled narrowing applied to `activeMcp` (which still governs
  // the parent agent's own toolsets/tool-search index, see chat.ts).
  it('scopedMcpServers (subagent allowlist) ignores client mcpEnabled toggles on ungrouped servers, but still excludes a non-pinned grouped server', async () => {
    const suffix = Date.now() + 3;
    const ungrouped = `solo-${suffix}`;
    const group = `compass-proj-${suffix}`;
    const pinned = `guolu-${suffix}`;
    const other = `shangzhong-${suffix}`;

    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: ungrouped,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group: undefined,
    });
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

    const threadId = `thread-scoped-subagent-allowlist-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(threadId, pinned);

    // Client toggles the ungrouped server off; no group toggle is meaningful
    // client-side (grouped servers ignore mcpEnabled per chat.ts).
    const declaredMcp = [ungrouped, pinned, other];
    const mcpEnabled: Record<string, boolean> = { [ungrouped]: false, [pinned]: true, [other]: true };

    const tenantActiveMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;

    const scoped = resolveScopedMcp(tenantActiveMcp, groups, pin);

    // Pre-fix bug: `activeMcp` (client-toggle-filtered) would have dropped
    // `ungrouped`. Post-fix `scopedMcpServers` is `scoped.active` — untouched
    // by mcpEnabled — so the ungrouped server survives for subagent dispatch.
    assert.ok(scoped.active.includes(ungrouped), 'ungrouped server survives despite client toggle-off');

    // The client-filtered list, still used for the parent agent's own
    // toolsets/tool-search index, does drop it — proving the two lists
    // diverge exactly as intended.
    const activeMcp = scoped.active.filter(
      (server) => groups[server] != null || mcpEnabled == null || mcpEnabled[server] !== false,
    );
    assert.ok(!activeMcp.includes(ungrouped), 'client-filtered activeMcp still drops the toggled-off server');

    // A grouped, non-pinned server is excluded from the subagent allowlist
    // regardless — project scoping, not client toggles, governs groups.
    assert.ok(!scoped.active.includes(other), 'non-pinned grouped server excluded from subagent allowlist');
    assert.ok(scoped.active.includes(pinned), 'pinned grouped server included in subagent allowlist');
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
