/**
 * mcp-apps host route project-scoping — composes the real embedded store +
 * thread-state (same pattern as mcp-store.group.test.ts / thread-state-
 * skills.test.ts's `thread project pin` block) against `resolveScopedServerNames`,
 * the boundary /api/mcp-apps/tools and /api/mcp-apps/host filter through before
 * building their MCPClient. This is the cleanest reachable seam: the route
 * itself builds a real @mastra/mcp MCPClient with no injectable factory, so
 * standing up a live MCP transport just to prove the *filter* is unwarranted
 * here — the filter is exactly what resolveScopedServerNames computes.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { resolveScopedServerNames } from './mcp-apps.js';
import { createRemoteMcpServer } from '../mcp-store.js';
import { ensureThreadState, setProject } from '../thread-state.js';
import { DEV_TENANT_ID, ensureDevTenant } from '../tenant.js';

const OTHER_TENANT_ID = 'other-tenant-mcpapps-scoping';
const DEV_USER = 'dev-user';

describe('resolveScopedServerNames', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  it('no threadId, no grouped server anywhere for the tenant: no filtering (today\'s tenant-wide behavior, unchanged)', async () => {
    // A tenant scratch id with zero configured servers has no grouped
    // server, so this must stay `undefined` — kept isolated from the other
    // cases in this file (which configure grouped servers under
    // DEV_TENANT_ID) by using a fresh, never-configured tenant id.
    const freshTenant = `no-groups-tenant-${Date.now()}`;
    const allow = await resolveScopedServerNames(freshTenant, DEV_USER, undefined);
    assert.equal(allow, undefined);
  });

  it('no threadId but the tenant has a grouped server: denies grouped servers, keeps ungrouped', async () => {
    const suffix = Date.now() + 1;
    const group = `mcp-apps-deny-${suffix}`;
    const grouped = `grouped-deny-${suffix}`;
    const ungrouped = `ungrouped-deny-${suffix}`;

    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: grouped,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
      group,
    });
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: ungrouped,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });

    // No threadId at all — this is the "omission" bypass the finding named:
    // it must NOT widen to tenant-wide once any server is grouped.
    const allow = await resolveScopedServerNames(DEV_TENANT_ID, DEV_USER, undefined);
    assert.ok(allow);
    assert.ok(!allow!.has(grouped));
    assert.ok(allow!.has(ungrouped));
  });

  it('a threadId belonging to another tenant is treated as missing (deny grouped, not 500, not borrowed pin)', async () => {
    const suffix = Date.now() + 2;
    const group = `mcp-apps-foreign-${suffix}`;
    const pinned = `foreign-pinned-${suffix}`;
    const other = `foreign-other-${suffix}`;
    const ungrouped = `foreign-ungrouped-${suffix}`;

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
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: ungrouped,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });

    // Thread is real, but owned by a different tenant.
    const threadId = `thread-mcpapps-foreign-${suffix}`;
    await ensureThreadState({ threadId, tenantId: OTHER_TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, pinned);

    // Caller claims DEV_TENANT_ID and tries to borrow the foreign thread's pin.
    const allow = await resolveScopedServerNames(DEV_TENANT_ID, DEV_USER, threadId);
    assert.ok(allow, 'must not throw/500 — resolves as if threadId were missing');
    assert.ok(!allow!.has(pinned), 'must not borrow the foreign thread\'s pin');
    assert.ok(!allow!.has(other));
    assert.ok(allow!.has(ungrouped));
  });

  it('with two grouped servers and a pinned thread owned by the caller, only the pinned member (+ ungrouped) is scoped in', async () => {
    const suffix = Date.now() + 3;
    const group = `mcp-apps-proj-${suffix}`;
    const pinned = `guolu-mcpapps-${suffix}`;
    const other = `shangzhong-mcpapps-${suffix}`;
    const ungrouped = `standalone-mcpapps-${suffix}`;

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
    await createRemoteMcpServer(DEV_TENANT_ID, {
      name: ungrouped,
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: {},
      enabled: true,
    });

    const threadId = `thread-mcpapps-scoped-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, pinned);

    const allow = await resolveScopedServerNames(DEV_TENANT_ID, DEV_USER, threadId);
    assert.ok(allow);
    assert.ok(allow!.has(pinned));
    assert.ok(!allow!.has(other));
    assert.ok(allow!.has(ungrouped));
  });

  it('an unpinned thread owned by the caller auto-pins deterministically (does not include every group member)', async () => {
    const suffix = Date.now() + 4;
    const group = `mcp-apps-proj-${suffix}`;
    const alpha = `alpha-mcpapps-${suffix}`;
    const beta = `beta-mcpapps-${suffix}`;

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

    const threadId = `thread-mcpapps-autopin-${suffix}`;
    await ensureThreadState({ threadId, tenantId: DEV_TENANT_ID, resourceId: DEV_USER });

    const allow = await resolveScopedServerNames(DEV_TENANT_ID, DEV_USER, threadId);
    assert.ok(allow);
    assert.ok(allow!.has(alpha)); // alphabetically-first auto-pin
    assert.ok(!allow!.has(beta));
  });
});
