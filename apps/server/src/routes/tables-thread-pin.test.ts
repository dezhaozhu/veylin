/**
 * routes/tables.ts's Compass-backed routes (schedule-detail, the governed
 * schedule-edit propose/preview/commit/discard routes, load-compass-schedule)
 * follow the CURRENTLY OPEN thread's PROJECT pin (project-cognition v3,
 * Phase B 5c re-key): threadId (query for the GET, body-or-query for the
 * POSTs) → `resolveCompassRequestScope` — resolveThreadPin (ownership check)
 * → resolvePinnedProjectScope (shared prelude) → POOLED scene-set toolsets —
 * then `resolveCompassServer` over the scope's record.
 *
 * Same pattern as mcp-apps-scoping.test.ts: composes the real embedded store
 * + thread-state against the exported route seam (no HTTP harness in this
 * repo). Every pre-re-key deny case carries over one-for-one: missing /
 * nonexistent / foreign-tenant / other-user threadId and unpinned threads all
 * fall back to the tenant toolsets with a null pin — which post-cutover hold
 * no compass at all, so resolution refuses; the legacy single-ungrouped-
 * compass fallback (rule 2/3) is preserved for deployments without
 * compass-identity.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { resolveCompassServer } from '../mcp-scoping.js';
import { ensureThreadState, setProject } from '../thread-state.js';
import { COMPASS_IDENTITY_GROUP } from '../compass-identity.js';
import { createRemoteMcpServer } from '../mcp-store.js';
import { createProject } from '../project-store.js';
import {
  invalidateCompassPool,
  sceneSetKey,
  type CompassPoolClientFactory,
} from '../compass-pool.js';
import { resolveCompassRequestScope } from './tables.js';

// Dedicated tenants (NOT the dev tenant) so this file's compass entry /
// project rows can never pollute other suites' store queries — same
// convention as project-pin-scoping.test.ts's per-describe tenants.
const TENANT_STAMP = Date.now();
const TENANT_ID = `tables-pin-tenant-${TENANT_STAMP}`;
const OTHER_TENANT_ID = `tables-pin-other-tenant-${TENANT_STAMP}`;
const DEV_USER = 'dev-user';
const CTX = { tenantId: TENANT_ID, resourceOwnerId: DEV_USER };

/** Tenant toolsets fixture: post-Task-4 truth — compass never in the cache. */
const TENANT_TOOLSETS: Record<string, unknown> = { github: { search_issues: {} } };
const DEPS = { getMcpToolsets: () => TENANT_TOOLSETS };
const GROUPS: Record<string, string | undefined> = {
  compass: COMPASS_IDENTITY_GROUP,
  github: undefined,
};

/** Recording pool client factory (compass-pool deps style, see project-pin-scoping.test.ts). */
function recordingFactory(
  calls: { id: string; header: string | undefined }[],
): CompassPoolClientFactory {
  return (init) => {
    const server = (
      init.servers as Record<string, { requestInit?: { headers?: Record<string, string> } }>
    )['compass'];
    const header = server?.requestInit?.headers?.['x-compass-source'];
    calls.push({ id: init.id, header });
    return {
      listToolsets: async () => ({
        compass: { [`tool_${header}`]: { description: `tool for ${header}` } },
      }),
      disconnect: async () => undefined,
    };
  };
}

describe('routes/tables.ts scope resolution: threadId → project pin → pooled toolsets → resolveCompassServer', () => {
  const stamp = Date.now();
  let guoluProject: Awaited<ReturnType<typeof createProject>>;

  before(async () => {
    await connectDb();
    await createRemoteMcpServer(TENANT_ID, {
      name: 'compass',
      transport: 'http',
      url: 'https://compass.example/mcp/',
      headers: { Authorization: 'Bearer test-token' },
      enabled: true,
      group: COMPASS_IDENTITY_GROUP,
      managed: true,
    });
    guoluProject = await createProject(TENANT_ID, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });
  });

  after(async () => {
    await invalidateCompassPool(TENANT_ID);
    await closeDb();
  });

  it('project-pinned thread owned by the caller: pooled scene-set record + entry pin + PROJECT id for provenance', async () => {
    const threadId = `thread-tables-pin-${stamp}`;
    await ensureThreadState({ threadId, tenantId: TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, guoluProject.id);

    const calls: { id: string; header: string | undefined }[] = [];
    const scope = await resolveCompassRequestScope(threadId, CTX, DEPS, {
      poolDeps: { createClient: recordingFactory(calls) },
    });
    assert.equal(scope.entryPin, 'compass');
    assert.equal(scope.projectId, guoluProject.id, 'provenance value = project id, never a toolset key');
    // The pooled connection was dialed for exactly the project's scene set...
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.header, 'guolu');
    // ...and resolution picks the pooled record's compass, never the tenant cache.
    const toolsets = scope.getToolsets();
    const serverName = resolveCompassServer(toolsets, GROUPS, scope.entryPin);
    assert.equal(serverName, 'compass');
    const tools = toolsets['compass'] as Record<string, unknown>;
    assert.ok(tools['tool_guolu'], 'toolset came from the scene-set connection');
    assert.equal(scope.loadScope?.projectId, guoluProject.id);
    assert.equal(scope.loadScope?.entryPin, 'compass');
  });

  it('rest scope: baseUrl strips /mcp/ off the entry url, headers carry entry headers + x-compass-source = sceneSetKey(sources)', async () => {
    const scope = await resolveCompassRequestScope(undefined, CTX, DEPS, {
      resolveScope: async () => ({
        project: guoluProject,
        entryPin: 'compass',
        sources: ['guolu', 'shangzhong'],
        entry: {
          id: 'entry-rest-stub',
          tenantId: TENANT_ID,
          name: 'compass',
          transport: 'http',
          url: 'http://h:8000/mcp/',
          headers: { Authorization: 'Bearer t' },
          enabled: true,
        },
      }),
      getPooledToolsets: async () => ({ compass: {} }),
    });
    assert.deepEqual(scope.rest, {
      baseUrl: 'http://h:8000',
      headers: { Authorization: 'Bearer t', 'x-compass-source': sceneSetKey(['guolu', 'shangzhong']) },
    });
    assert.deepEqual(scope.loadScope?.rest, scope.rest);
  });

  it('no threadId at all: tenant fallback with a null pin — no compass in the cache means refusal', async () => {
    const scope = await resolveCompassRequestScope(undefined, CTX, DEPS);
    assert.equal(scope.entryPin, null);
    assert.equal(scope.projectId, null);
    assert.equal(scope.loadScope, undefined);
    assert.equal(scope.rest, null);
    assert.equal(resolveCompassServer(scope.getToolsets(), GROUPS, scope.entryPin), null);
  });

  it('a threadId that does not exist: same refusal as missing threadId', async () => {
    const scope = await resolveCompassRequestScope(`thread-does-not-exist-${stamp}`, CTX, DEPS);
    assert.equal(scope.entryPin, null);
    assert.equal(resolveCompassServer(scope.getToolsets(), GROUPS, scope.entryPin), null);
  });

  it("a threadId belonging to another tenant: must not borrow the foreign thread's pin", async () => {
    const threadId = `thread-tables-foreign-${stamp}`;
    await ensureThreadState({ threadId, tenantId: OTHER_TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, guoluProject.id);

    const scope = await resolveCompassRequestScope(threadId, CTX, DEPS);
    assert.equal(scope.entryPin, null);
    assert.equal(scope.projectId, null);
    assert.equal(resolveCompassServer(scope.getToolsets(), GROUPS, scope.entryPin), null);
  });

  it('a threadId owned by a different user under the same tenant: denied', async () => {
    const threadId = `thread-tables-otheruser-${stamp}`;
    await ensureThreadState({ threadId, tenantId: TENANT_ID, resourceId: 'someone-else' });
    await setProject(threadId, guoluProject.id);

    const scope = await resolveCompassRequestScope(threadId, CTX, DEPS);
    assert.equal(scope.entryPin, null);
    assert.equal(scope.projectId, null);
  });

  it('owned thread with no pin set (unpinned): tenant fallback, refusal without an ungrouped compass', async () => {
    const threadId = `thread-tables-unpinned-${stamp}`;
    await ensureThreadState({ threadId, tenantId: TENANT_ID, resourceId: DEV_USER });

    const scope = await resolveCompassRequestScope(threadId, CTX, DEPS);
    assert.equal(scope.entryPin, null);
    assert.equal(resolveCompassServer(scope.getToolsets(), GROUPS, scope.entryPin), null);
  });

  it('a LEGACY entry-name pin (pre-migration leftover) denies like any stale pin', async () => {
    const threadId = `thread-tables-legacypin-${stamp}`;
    await ensureThreadState({ threadId, tenantId: TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, 'compass-guolu');

    const scope = await resolveCompassRequestScope(threadId, CTX, DEPS);
    assert.equal(scope.entryPin, null);
    assert.equal(scope.projectId, null);
    assert.equal(resolveCompassServer(scope.getToolsets(), GROUPS, scope.entryPin), null);
  });

  it('pool failure under a valid pin: empty record — honest refusal, never the tenant cache', async () => {
    const threadId = `thread-tables-poolfail-${stamp}`;
    await ensureThreadState({ threadId, tenantId: TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, guoluProject.id);

    const scope = await resolveCompassRequestScope(threadId, CTX, DEPS, {
      getPooledToolsets: async () => null,
    });
    assert.equal(scope.entryPin, 'compass', 'the pin itself resolved — the refusal is the pool\'s');
    assert.deepEqual(scope.getToolsets(), {});
    assert.equal(resolveCompassServer(scope.getToolsets(), GROUPS, scope.entryPin), null);
    assert.deepEqual(scope.loadScope?.toolsets, {}, 'load path shares the same empty record');
  });

  it('legacy ungrouped single-compass deployment, no pin: rule 2/3 fallback still resolves (unchanged from today)', async () => {
    const only = `compass-solo-${stamp}`;
    const legacyDeps = { getMcpToolsets: () => ({ [only]: {} }) };
    const scope = await resolveCompassRequestScope(undefined, CTX, legacyDeps);
    assert.equal(scope.entryPin, null);
    assert.equal(
      resolveCompassServer(scope.getToolsets(), { [only]: undefined }, scope.entryPin),
      only,
    );
  });
});
