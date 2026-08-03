import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { resolveScopedMcp } from './mcp-scoping.js';
import {
  createRemoteMcpServer,
  listActiveMcpServerNames,
  listMcpServerGroups,
} from './mcp-store.js';
import {
  computeProjectMovePatch,
  ensureThreadState,
  getThreadState,
  listThreadProjects,
  mergeActivatedSkillContents,
  setProject,
  setProjectWithMoveTracking,
} from './thread-state.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';
import { proposeScheduleEdit } from './schedule-edit.js';

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

  describe('computeProjectMovePatch / setProjectWithMoveTracking (audit fix #3: thread-move boundary marker)', () => {
    it('computeProjectMovePatch is a no-op move when there was no prior pin', () => {
      const patch = computeProjectMovePatch(null, 'compass-guolu');
      assert.deepEqual(patch, { project: 'compass-guolu' });
    });

    it('computeProjectMovePatch is a no-op move when re-pinning the same project', () => {
      const patch = computeProjectMovePatch('compass-guolu', 'compass-guolu');
      assert.deepEqual(patch, { project: 'compass-guolu' });
    });

    it('computeProjectMovePatch stamps movedFrom/movedAt when leaving a non-null pin for a different one', () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      const patch = computeProjectMovePatch('compass-guolu', 'compass-shangzhong', now);
      assert.deepEqual(patch, {
        project: 'compass-shangzhong',
        movedFrom: 'compass-guolu',
        movedAt: now.toISOString(),
      });
    });

    it('computeProjectMovePatch stamps a move even when clearing the pin to null', () => {
      const now = new Date('2026-07-01T00:00:00.000Z');
      const patch = computeProjectMovePatch('compass-guolu', null, now);
      assert.deepEqual(patch, { project: null, movedFrom: 'compass-guolu', movedAt: now.toISOString() });
    });

    it('set pin A then pin B → state carries movedFrom=A', async () => {
      const threadId = `thread-project-move-${Date.now()}`;
      await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });

      await setProjectWithMoveTracking(threadId, null, 'compass-guolu');
      const afterA = await getThreadState(threadId);
      assert.equal(afterA?.project, 'compass-guolu');
      assert.equal(afterA?.movedFrom, null, 'first pin (no prior project) is not a move');

      await setProjectWithMoveTracking(threadId, afterA!.project, 'compass-shangzhong');
      const afterB = await getThreadState(threadId);
      assert.equal(afterB?.project, 'compass-shangzhong');
      assert.equal(afterB?.movedFrom, 'compass-guolu');
      assert.ok(afterB?.movedAt, 'movedAt should be stamped');
    });

    it('re-pinning the same project again does not erase the earlier move marker', async () => {
      const threadId = `thread-project-move-idempotent-${Date.now()}`;
      await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });

      await setProjectWithMoveTracking(threadId, null, 'compass-guolu');
      await setProjectWithMoveTracking(threadId, 'compass-guolu', 'compass-shangzhong');
      const afterMove = await getThreadState(threadId);
      assert.equal(afterMove?.movedFrom, 'compass-guolu');

      // Idempotent re-pin of the same project — not a move, must not clear movedFrom.
      await setProjectWithMoveTracking(threadId, 'compass-shangzhong', 'compass-shangzhong');
      const afterNoop = await getThreadState(threadId);
      assert.equal(afterNoop?.project, 'compass-shangzhong');
      assert.equal(afterNoop?.movedFrom, 'compass-guolu', 'idempotent re-pin must not erase movedFrom');
    });
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

  // CRITICAL-finding regression, refined: scoping (which member of a group is
  // the pin winner) must still run against server-truth active servers, never
  // the client-mcpEnabled-filtered list — that property must SURVIVE. What
  // changed: an explicit client mcpEnabled[pinned] === false is no longer
  // ignored outright — it now suppresses the pinned member's tools for *this
  // request* (composer-mcp-flyout.tsx's plain toggle-off semantics), while
  // still never causing a re-pin/switch to another group member, and never
  // rewriting the stored pin. Composes the real store + thread-state +
  // resolveScopedMcp exactly as chat.ts's request handler does.
  it('client mcpEnabled=false on the pinned member never re-pins/persists, but does suppress its tools for this request', async () => {
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

    // The user explicitly turned the group's capability toggle off in the
    // flyout for this chat; the client claims the pinned server is disabled
    // and the other group member is enabled (it never was — grouped toggles
    // write the same value to every member, but a stale/adversarial client
    // body must not matter either way).
    const declaredMcp = [pinned, other];
    const mcpEnabled: Record<string, boolean> = { [pinned]: false, [other]: true };

    // chat.ts: scoping runs against server-truth tenantActiveMcp, never the
    // client-filtered list — this decides the pin winner and is untouched by
    // mcpEnabled.
    const tenantActiveMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;
    assert.equal(pin, pinned);

    const scoped = resolveScopedMcp(tenantActiveMcp, groups, pin);
    // SURVIVES: pin was valid against server truth — no re-pin/switch needed,
    // regardless of the client's toggle.
    assert.equal(scoped.autoPin, null);
    // NEW: mcpEnabled applies uniformly to grouped and ungrouped servers —
    // an explicit false drops the pinned member's tools for this request too.
    const activeMcp = scoped.active.filter(
      (server) => mcpEnabled == null || mcpEnabled[server] !== false,
    );

    // NEW property: the explicit off-switch suppresses the pinned member's
    // tools for this request — no compass tools this turn.
    assert.ok(!activeMcp.includes(pinned), 'explicit mcpEnabled=false suppresses the pinned member');
    assert.ok(!activeMcp.includes(other), 'the non-pinned member was never in scope regardless');

    // SURVIVES: the stored pin is unchanged — no silent rewrite was persisted,
    // and no switch to `other` happened even though `other` claims enabled:true.
    const hydrated = await getThreadState(threadId);
    assert.equal(hydrated?.project, pinned);
  });

  // Regression for the subagent-allowlist/client-toggle conflation, refined.
  // Baseline (original bug) handed a dispatched subagent its preset's full
  // declared MCP list regardless of client mcpEnabled toggles. The first fix
  // made chat.ts's `scopedMcpServers` (read by scopedMcpServersFromCtx for
  // subagent dispatch, see agent-task-runner.ts) ignore mcpEnabled entirely —
  // fine for *ungrouped* servers (an implicit per-server toggle-off in the
  // toolbar shouldn't silently strip a subagent's tool), but too broad for
  // *grouped* servers now that the flyout exposes an explicit one-toggle-per-
  // capability off-switch: a deliberate "Compass off for this chat" should
  // plausibly also mean "no Compass tools for subagents dispatched from this
  // turn". This test covers both: ungrouped toggle-off still does NOT reach
  // the subagent allowlist; an explicit grouped toggle-off on the pinned
  // member DOES (without ever re-pinning/switching to another group member).
  it('scopedMcpServers (subagent allowlist): ungrouped toggle-off is ignored, but an explicit grouped toggle-off on the pinned member is honored', async () => {
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

    // Client toggles the ungrouped server off AND the group's capability off
    // (the flyout writes the same mcpEnabled value to every group member, so
    // both the pinned and non-pinned member claim false here).
    const declaredMcp = [ungrouped, pinned, other];
    const mcpEnabled: Record<string, boolean> = { [ungrouped]: false, [pinned]: false, [other]: false };

    const tenantActiveMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;

    const scoped = resolveScopedMcp(tenantActiveMcp, groups, pin);
    // SURVIVES: scoping itself (the pin winner) is decided before mcpEnabled
    // is ever consulted — no re-pin/switch happened.
    assert.equal(scoped.autoPin, null);
    assert.ok(scoped.active.includes(pinned), 'scoping still resolves the pin winner regardless of mcpEnabled');
    assert.ok(!scoped.active.includes(other), 'non-pinned grouped server excluded from scoping regardless');

    // The parent agent's own toolsets/tool-search index (activeMcp): mcpEnabled
    // applies uniformly now, so both toggled-off servers drop out.
    const activeMcp = scoped.active.filter(
      (server) => mcpEnabled == null || mcpEnabled[server] !== false,
    );
    assert.ok(!activeMcp.includes(ungrouped), 'ungrouped toggle-off drops it from the parent agent');
    assert.ok(!activeMcp.includes(pinned), 'grouped toggle-off drops the pinned member from the parent agent');

    // The subagent allowlist: ungrouped toggle-off is ignored (unchanged from
    // the original fix); an explicit grouped toggle-off on the pinned member
    // IS honored (the new decision) — and still never re-pins to `other`.
    const scopedMcpServersForSubagents = scoped.active.filter(
      (server) => groups[server] == null || mcpEnabled == null || mcpEnabled[server] !== false,
    );
    assert.ok(
      scopedMcpServersForSubagents.includes(ungrouped),
      'ungrouped server survives in the subagent allowlist despite client toggle-off',
    );
    assert.ok(
      !scopedMcpServersForSubagents.includes(pinned),
      'explicit grouped toggle-off on the pinned member suppresses it in the subagent allowlist too',
    );
    assert.ok(
      !scopedMcpServersForSubagents.includes(other),
      'non-pinned grouped server stays excluded from the subagent allowlist (unrelated to the toggle)',
    );
  });

  // 全项目制 + 个人区 (2026-07-27): routes/chat.ts no longer applies or
  // persists resolveScopedMcp's auto-pin for an unpinned thread — that was
  // a silent default-tenant guess. resolveScopedMcp's pure `autoPin`
  // computation is untouched (mcp-apps.ts's resolveScopedServerNames still
  // calls it against a REAL pin), but an unpinned thread must get NO
  // grouped servers at all, and the pin must stay null. Composes the real
  // store + thread-state exactly as chat.ts's request handler does.
  it('an unpinned thread denies grouped servers and does not persist an auto-pin (personal area)', async () => {
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

    const threadId = `thread-scoped-personal-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });

    const declaredMcp = [alpha, beta];
    const activeMcp = await listActiveMcpServerNames(DEV_TENANT_ID, declaredMcp);
    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;
    assert.equal(pin, null);

    const scoped = resolveScopedMcp(activeMcp, groups, pin);
    // The pure fn still computes an auto-pick (other callers rely on it) …
    assert.equal(scoped.autoPin, alpha); // alphabetically first

    // … but chat.ts's request handler must not apply it: filter every
    // grouped member out of `active` instead of keeping the auto-pick.
    const scopedActive =
      pin == null ? scoped.active.filter((server) => groups[server] == null) : scoped.active;
    assert.ok(!scopedActive.includes(alpha));
    assert.ok(!scopedActive.includes(beta));

    // No silent persistence: the thread stays unpinned.
    const hydrated = await getThreadState(threadId);
    assert.equal(hydrated?.project, null);
  });

  // I1 final-review fix: schedule-edit.ts (and, identically, table-tools.ts /
  // routes/tables.ts) must resolve the Compass toolset through the thread's
  // real pin + the tenant's real server groups — never a hardcoded
  // toolsets['compass'] — or a thread pinned to one group member would still
  // read/WRITE through another. Composes the real store (grouped MCP server
  // rows), real thread-state (project pin), and schedule-edit.ts's
  // proposeScheduleEdit exactly the way routes/chat.ts's guidance block (and,
  // for a hypothetical thread-scoped grid, routes/tables.ts) would.
  it('a pinned thread resolves propose_schedule_edit to the pinned Compass server, not the group\'s other member', async () => {
    const suffix = Date.now() + 4;
    const group = `compass-i1-${suffix}`;
    const pinned = `compass-guolu-${suffix}`;
    const other = `compass-shangzhong-${suffix}`;

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

    const threadId = `thread-i1-schedule-edit-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(threadId, pinned);

    const groups = await listMcpServerGroups(DEV_TENANT_ID);
    const threadState = await getThreadState(threadId);
    const pin = threadState?.project ?? null;
    assert.equal(pin, pinned);

    // Stub toolsets: both group members are "connected", each with its own
    // propose_schedule_edit that tags which server handled the call.
    let calledOn: string | null = null;
    const toolsets = {
      [pinned]: {
        propose_schedule_edit: {
          execute: async () => {
            calledOn = pinned;
            return { ops: 1, note: 'handled by pinned server' };
          },
        },
      },
      [other]: {
        propose_schedule_edit: {
          execute: async () => {
            calledOn = other;
            return { ops: 99, note: 'WRONG server' };
          },
        },
      },
    };

    const out = await proposeScheduleEdit(
      () => toolsets,
      { field: 'resource', job_id: 'J1', value: 'M1' },
      groups,
      pin,
    );

    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.ops, 1);
    assert.equal(calledOn, pinned);
    assert.notEqual(calledOn, other);
  });
});

// listThreadProjects — bulk thread→project map backing GET /api/projects/threads
// (Projects sidebar). Composes the real embedded store the same way the other
// describe block above does (ensureThreadState + setProject), then asserts the
// map is scoped to non-null pins for the caller's tenant only.
describe('listThreadProjects', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('returns only non-null pins, scoped to the caller tenant', async () => {
    const suffix = Date.now();
    const otherTenant = `list-thread-projects-other-tenant-${suffix}`;

    const pinnedA = `thread-list-projects-pinned-a-${suffix}`;
    const pinnedB = `thread-list-projects-pinned-b-${suffix}`;
    const unpinned = `thread-list-projects-unpinned-${suffix}`;
    const otherTenantThread = `thread-list-projects-other-tenant-${suffix}`;

    await ensureThreadState({ threadId: pinnedA, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(pinnedA, `compass-guolu-${suffix}`);

    await ensureThreadState({ threadId: pinnedB, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    await setProject(pinnedB, `compass-shangzhong-${suffix}`);

    await ensureThreadState({ threadId: unpinned, tenantId: DEV_TENANT_ID, resourceId: 'dev-user' });
    // left unpinned — project stays null

    await ensureThreadState({ threadId: otherTenantThread, tenantId: otherTenant, resourceId: 'dev-user' });
    await setProject(otherTenantThread, `compass-other-${suffix}`);

    const map = await listThreadProjects(DEV_TENANT_ID);

    assert.equal(map[pinnedA], `compass-guolu-${suffix}`);
    assert.equal(map[pinnedB], `compass-shangzhong-${suffix}`);
    assert.equal(map[unpinned], undefined);
    assert.equal(map[otherTenantThread], undefined);

    const otherMap = await listThreadProjects(otherTenant);
    assert.equal(otherMap[otherTenantThread], `compass-other-${suffix}`);
    assert.equal(otherMap[pinnedA], undefined);
  });

  it('returns an empty object when the tenant has no pinned threads', async () => {
    const emptyTenant = `list-thread-projects-empty-tenant-${Date.now()}`;
    const map = await listThreadProjects(emptyTenant);
    assert.deepEqual(map, {});
  });
});
