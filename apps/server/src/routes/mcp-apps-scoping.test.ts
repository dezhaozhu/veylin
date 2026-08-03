/**
 * mcp-apps host route project-scoping (project-cognition v3, Phase B 5b) —
 * composes the real embedded store + thread-state (same pattern as
 * mcp-store.group.test.ts / thread-state-skills.test.ts's `thread project pin`
 * block) against `resolveScopedServerNames`, the boundary /api/mcp-apps/tools
 * and /api/mcp-apps/host filter through before building their MCPClient, and
 * against `freshClient`, whose injectable client factory lets us record the
 * exact server configs (including the compass entry's per-connection
 * `x-compass-source` scene binding) without standing up a live MCP transport.
 * This is the cleanest reachable seam: no HTTP harness exists in this repo.
 *
 * RE-KEY (5b): pins are PROJECT ids now — fixtures create real `project` rows
 * and pin threads/pass projectId params to their ids. Every deny-posture
 * assertion keeps its pre-re-key semantics byte-identically at the decision
 * level: unowned/missing threadId ⇒ ungrouped-only; orphan (owned thread, no
 * valid pin — unpinned OR stale/legacy/foreign/disabled pin) ⇒ grouped
 * denied; no-grouped-tenant ⇒ `allow: undefined` widening only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MCPClient } from '@mastra/mcp';
import { closeDb, connectDb } from '@veylin/db';
import { collectMcpAppTools, freshClient, resolveScopedServerNames } from './mcp-apps.js';
import { COMPASS_IDENTITY_GROUP } from '../compass-identity.js';
import { sceneSetKey } from '../compass-pool.js';
import { createRemoteMcpServer } from '../mcp-store.js';
import { createProject, disableProject } from '../project-store.js';
import { ensureThreadState, setProject } from '../thread-state.js';

const OTHER_TENANT_ID = 'other-tenant-mcpapps-scoping';
const DEV_USER = 'dev-user';

/** Seed the reconciler's single enabled compass-identity entry for a tenant. */
async function seedCompassEntry(
  tenantId: string,
  overrides: { name?: string; enabled?: boolean } = {},
) {
  return createRemoteMcpServer(tenantId, {
    name: overrides.name ?? 'compass',
    transport: 'http',
    url: 'https://compass.example/mcp/',
    headers: { Authorization: 'Bearer test-token' },
    enabled: overrides.enabled ?? true,
    group: COMPASS_IDENTITY_GROUP,
    managed: true,
  });
}

async function seedUngrouped(tenantId: string, name: string) {
  return createRemoteMcpServer(tenantId, {
    name,
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: {},
    enabled: true,
  });
}

before(async () => {
  await connectDb();
});

after(async () => {
  await closeDb();
});

describe('resolveScopedServerNames', () => {
  it('no threadId, no grouped server anywhere for the tenant: no filtering (today\'s tenant-wide behavior, unchanged)', async () => {
    // A tenant scratch id with zero configured servers has no grouped
    // server, so this must stay `allow: undefined` — the ONLY case that ever
    // widens, byte-identical to the pre-re-key posture.
    const freshTenant = `no-groups-tenant-${Date.now()}`;
    const scoped = await resolveScopedServerNames(freshTenant, DEV_USER, undefined);
    assert.equal(scoped.allow, undefined);
    assert.equal(scoped.compassScope, null);
  });

  it('no threadId but the tenant has a grouped server: denies grouped servers, keeps ungrouped', async () => {
    const suffix = Date.now() + 1;
    const tenant = `mcpapps-deny-${suffix}`;
    const ungrouped = `ungrouped-deny-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);

    // No threadId at all — this is the "omission" bypass the finding named:
    // it must NOT widen to tenant-wide once any server is grouped.
    const scoped = await resolveScopedServerNames(tenant, DEV_USER, undefined);
    assert.ok(scoped.allow);
    assert.ok(!scoped.allow!.has('compass'));
    assert.ok(scoped.allow!.has(ungrouped));
    assert.equal(scoped.compassScope, null);
  });

  it('a threadId belonging to another tenant is treated as missing (deny grouped, not 500, not borrowed pin)', async () => {
    const suffix = Date.now() + 2;
    const tenant = `mcpapps-foreign-${suffix}`;
    const ungrouped = `foreign-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);
    const project = await createProject(tenant, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });

    // Thread is real and pinned to a project VALID for the caller's tenant,
    // but the thread itself is owned by a different tenant.
    const threadId = `thread-mcpapps-foreign-${suffix}`;
    await ensureThreadState({ threadId, tenantId: OTHER_TENANT_ID, resourceId: DEV_USER });
    await setProject(threadId, project.id);

    // Caller claims `tenant` and tries to borrow the foreign thread's pin.
    const scoped = await resolveScopedServerNames(tenant, DEV_USER, threadId);
    assert.ok(scoped.allow, 'must not throw/500 — resolves as if threadId were missing');
    assert.ok(!scoped.allow!.has('compass'), 'must not borrow the foreign thread\'s pin');
    assert.ok(scoped.allow!.has(ungrouped));
    assert.equal(scoped.compassScope, null);
  });

  it('a pinned thread owned by the caller scopes in only the pinned project\'s entry (+ ungrouped) with its scene set', async () => {
    const suffix = Date.now() + 3;
    const tenant = `mcpapps-scoped-${suffix}`;
    const ungrouped = `standalone-mcpapps-${suffix}`;
    await seedCompassEntry(tenant);
    // A disabled legacy per-scene member of the same group (the reconciler's
    // disabled-not-deleted history rows) must never surface.
    await seedCompassEntry(tenant, { name: `compass-guolu-${suffix}`, enabled: false });
    await seedUngrouped(tenant, ungrouped);
    const project = await createProject(tenant, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });

    const threadId = `thread-mcpapps-scoped-${suffix}`;
    await ensureThreadState({ threadId, tenantId: tenant, resourceId: DEV_USER });
    await setProject(threadId, project.id);

    const scoped = await resolveScopedServerNames(tenant, DEV_USER, threadId);
    assert.ok(scoped.allow);
    assert.ok(scoped.allow!.has('compass'));
    assert.ok(!scoped.allow!.has(`compass-guolu-${suffix}`));
    assert.ok(scoped.allow!.has(ungrouped));
    // The scope rides along so freshClient can compose the scene binding.
    assert.equal(scoped.compassScope?.project?.id, project.id);
    assert.equal(scoped.compassScope?.entryPin, 'compass');
    assert.equal(scoped.compassScope?.entry?.name, 'compass');
    assert.deepEqual(scoped.compassScope?.sources, ['guolu']);
  });

  it('an owned thread WITHOUT a pin denies grouped servers (no silent default member)', async () => {
    // review 2026-07-27 orphan-thread finding: this read-only proxy must deny
    // grouped members until the thread actually has a (valid) pin.
    const suffix = Date.now().toString(36);
    const tenant = `mcpapps-orphan-${suffix}`;
    await seedCompassEntry(tenant);
    const threadId = `orphan-scope-${suffix}`;
    await ensureThreadState({ threadId, tenantId: tenant, resourceId: DEV_USER });
    const scoped = await resolveScopedServerNames(tenant, DEV_USER, threadId);
    assert.ok(scoped.allow, 'grouped tenant must scope down, not widen');
    assert.equal(scoped.allow!.has('compass'), false);
    assert.equal(scoped.compassScope, null);
  });

  it('an owned thread pinned to a LEGACY entry name (pre-migration leftover) denies grouped exactly like unpinned', async () => {
    const suffix = (Date.now() + 4).toString(36);
    const tenant = `mcpapps-legacy-${suffix}`;
    const ungrouped = `legacy-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);
    const threadId = `legacy-pin-${suffix}`;
    await ensureThreadState({ threadId, tenantId: tenant, resourceId: DEV_USER });
    // The old pin currency — an MCP entry name — is not a project id: the
    // prelude denies it like any other stale pin.
    await setProject(threadId, 'compass-guolu');
    const scoped = await resolveScopedServerNames(tenant, DEV_USER, threadId);
    assert.ok(scoped.allow);
    assert.equal(scoped.allow!.has('compass'), false);
    assert.ok(scoped.allow!.has(ungrouped));
    assert.equal(scoped.compassScope, null);
  });

  it('projectId param (项目首页 data plane): a tenant-owned enabled project grants exactly its scene set + ungrouped servers', async () => {
    const suffix = Date.now() + 5;
    const tenant = `mcpapps-projectid-${suffix}`;
    const ungrouped = `projectid-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);
    const project = await createProject(tenant, {
      name: '对比分析',
      sources: ['shangzhong', 'guolu'],
    });

    const scoped = await resolveScopedServerNames(tenant, DEV_USER, undefined, project.id);
    assert.ok(scoped.allow);
    assert.ok(scoped.allow!.has('compass'));
    assert.ok(scoped.allow!.has(ungrouped));
    // Exactly that project's scene set — nothing widened, nothing dropped.
    assert.deepEqual(scoped.compassScope?.sources, ['shangzhong', 'guolu']);
    assert.equal(scoped.compassScope?.project?.id, project.id);
    assert.equal(scoped.compassScope?.entryPin, 'compass');
  });

  it('a FOREIGN-tenant projectId is denied exactly like an unowned threadId (grouped denied, ungrouped kept)', async () => {
    const suffix = Date.now() + 6;
    const tenant = `mcpapps-projforeign-a-${suffix}`;
    const otherTenant = `mcpapps-projforeign-b-${suffix}`;
    const ungrouped = `projforeign-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);
    const foreign = await createProject(otherTenant, { name: '上重', sources: ['shangzhong'] });

    const scoped = await resolveScopedServerNames(tenant, DEV_USER, undefined, foreign.id);
    assert.ok(scoped.allow, 'grouped tenant must scope down, not widen');
    assert.equal(scoped.allow!.has('compass'), false);
    assert.ok(scoped.allow!.has(ungrouped));
    assert.equal(scoped.compassScope, null);
  });

  it('a DISABLED project\'s projectId is denied the same way', async () => {
    const suffix = Date.now() + 7;
    const tenant = `mcpapps-projdisabled-${suffix}`;
    const ungrouped = `projdisabled-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);
    const project = await createProject(tenant, { name: '停用厂', sources: ['guolu'] });
    await disableProject(tenant, project.id);

    const scoped = await resolveScopedServerNames(tenant, DEV_USER, undefined, project.id);
    assert.ok(scoped.allow);
    assert.equal(scoped.allow!.has('compass'), false);
    assert.ok(scoped.allow!.has(ungrouped));
    assert.equal(scoped.compassScope, null);
  });

  it('an invalid projectId denies even when the accompanying threadId carries a valid pin (precedence cannot widen)', async () => {
    const suffix = Date.now() + 8;
    const tenant = `mcpapps-projprecedence-${suffix}`;
    await seedCompassEntry(tenant);
    const project = await createProject(tenant, { name: '锅炉厂', sources: ['guolu'] });
    const threadId = `thread-projprecedence-${suffix}`;
    await ensureThreadState({ threadId, tenantId: tenant, resourceId: DEV_USER });
    await setProject(threadId, project.id);

    const scoped = await resolveScopedServerNames(
      tenant,
      DEV_USER,
      threadId,
      `not-a-project-${suffix}`,
    );
    assert.ok(scoped.allow);
    assert.equal(scoped.allow!.has('compass'), false, 'projectId is the pin when present — its deny must not fall back to the thread pin');
    assert.equal(scoped.compassScope, null);
  });
});

describe('freshClient (host connection composition)', () => {
  /** Recording factory: captures each composed { id, servers } init. */
  function recordingFactory(calls: { id: string; servers: Record<string, unknown> }[]) {
    return (init: { id: string; servers: Record<string, unknown> }) => {
      calls.push(init);
      return { disconnect: async () => undefined } as unknown as MCPClient;
    };
  }

  type ComposedServer = {
    url?: URL;
    requestInit?: { headers?: Record<string, string> };
  };

  it('the compass connection carries entry headers + x-compass-source = sceneSetKey(pinned project\'s sources)', async () => {
    const suffix = Date.now() + 20;
    const tenant = `mcpapps-fresh-${suffix}`;
    const ungrouped = `fresh-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);
    // Deliberately unsorted sources: the header must be the canonical
    // sceneSetKey (sorted, de-duped) — the same single source of truth the
    // compass pool keys and binds its connections with.
    const project = await createProject(tenant, {
      name: '对比分析',
      sources: ['shangzhong', 'guolu'],
    });
    const threadId = `thread-fresh-${suffix}`;
    await ensureThreadState({ threadId, tenantId: tenant, resourceId: DEV_USER });
    await setProject(threadId, project.id);

    const scoped = await resolveScopedServerNames(tenant, DEV_USER, threadId);
    const calls: { id: string; servers: Record<string, unknown> }[] = [];
    await freshClient(tenant, scoped, recordingFactory(calls));

    assert.equal(calls.length, 1);
    const servers = calls[0]!.servers as Record<string, ComposedServer>;
    // The compass config is composed (base configs exclude the compass group)…
    const compass = servers['compass'];
    assert.ok(compass, 'compass server config composed from the project scope');
    assert.equal(compass!.url?.href, 'https://compass.example/mcp/');
    // …with the entry's own headers plus the scene binding, byte-identical to
    // the pooled connection's (sceneSetKey is the shared source of truth).
    assert.deepEqual(compass!.requestInit?.headers, {
      Authorization: 'Bearer test-token',
      'x-compass-source': 'guolu,shangzhong',
    });
    assert.equal(
      compass!.requestInit?.headers?.['x-compass-source'],
      sceneSetKey(scoped.compassScope!.sources),
    );
    // Non-compass servers pass through unchanged.
    assert.ok(servers[ungrouped]);

    // The hostSeq gotcha: every request's client gets a UNIQUE id (id reuse
    // throws "MCPClient initialized multiple times" → 500s).
    await freshClient(tenant, scoped, recordingFactory(calls));
    assert.equal(calls.length, 2);
    assert.notEqual(calls[1]!.id, calls[0]!.id);
  });

  it('a denied scope composes NO compass server at all — a headerless compass connection is structurally impossible here', async () => {
    const suffix = Date.now() + 21;
    const tenant = `mcpapps-fresh-deny-${suffix}`;
    const ungrouped = `freshdeny-ungrouped-${suffix}`;
    await seedCompassEntry(tenant);
    await seedUngrouped(tenant, ungrouped);

    // Missing threadId ⇒ ungrouped-only allow, null compassScope.
    const scoped = await resolveScopedServerNames(tenant, DEV_USER, undefined);
    const calls: { id: string; servers: Record<string, unknown> }[] = [];
    await freshClient(tenant, scoped, recordingFactory(calls));

    const servers = calls[0]!.servers;
    assert.equal(servers['compass'], undefined, 'compass absent: excluded from base configs AND no scope overlay');
    assert.ok(servers[ungrouped]);
  });
});

describe('collectMcpAppTools', () => {
  it('returns the flat toolName map plus the additive byServer map (servers without UI tools have no key)', () => {
    const toolsets = {
      compass: {
        get_scene_card: { mcp: { _meta: { ui: { resourceUri: 'ui://compass/scene-card' } } } },
        get_gantt: { mcp: { _meta: { ui: { resourceUri: 'ui://compass/gantt' } } } },
        list_orders: {}, // no UI declaration → excluded everywhere
      },
      github: {
        search_issues: {}, // server with zero UI tools → no byServer key
      },
    };
    const { tools, byServer } = collectMcpAppTools(toolsets);
    assert.deepEqual(tools, {
      get_scene_card: 'ui://compass/scene-card',
      get_gantt: 'ui://compass/gantt',
    });
    assert.equal(byServer['github'], undefined);
    assert.deepEqual(byServer, {
      compass: {
        get_scene_card: 'ui://compass/scene-card',
        get_gantt: 'ui://compass/gantt',
      },
    });
  });
});
