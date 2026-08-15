import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import type { McpServer, Project } from '@veylin/shared';
import {
  fetchCompassSources,
  COMPASS_ENTRY_NAME,
  COMPASS_IDENTITY_GROUP,
  createCompassIdentitySyncLoop,
  desiredCompassEntries,
  desiredDefaultProjectsVsCurrent,
  desiredVsCurrent,
  isCompassIdentitySyncEnabled,
  parseCompassIdentityConfig,
  reconcileCompassIdentity,
  type CompassIdentityConfig,
  type CompassIdentitySummary,
} from './compass-identity.js';
import {
  createRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from './mcp-store.js';
import { createProject, listProjects, updateProject } from './project-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

const CONFIG: CompassIdentityConfig = { url: 'http://compass.local:8000', token: 'acct-jwt' };

const ZERO_SUMMARY: CompassIdentitySummary = {
  created: 0,
  adopted: 0,
  disabled: 0,
  unchanged: 0,
  projectsCreated: 0,
  projectsEnabled: 0,
  projectsDisabled: 0,
};

function server(overrides: Partial<McpServer> & Pick<McpServer, 'id' | 'name'>): McpServer {
  return {
    tenantId: DEV_TENANT_ID,
    transport: 'http',
    url: 'https://stale.example.com/mcp',
    headers: {},
    enabled: true,
    ...overrides,
  };
}

function project(overrides: Partial<Project> & Pick<Project, 'id' | 'sources'>): Project {
  return {
    tenantId: DEV_TENANT_ID,
    name: overrides.id,
    managed: true,
    enabled: true,
    ...overrides,
  };
}

describe('parseCompassIdentityConfig', () => {
  it('is off (null) when the env var is unset — no warning expected from the caller', () => {
    assert.equal(parseCompassIdentityConfig(''), null);
    assert.equal(parseCompassIdentityConfig(undefined), null);
  });

  it('parses a valid {url, token} JSON payload, trimming a trailing slash off the url', () => {
    const parsed = parseCompassIdentityConfig('{"url":"http://x:8000/","token":"abc"}');
    assert.deepEqual(parsed, { url: 'http://x:8000', token: 'abc' });
  });

  it('is null for invalid JSON', () => {
    assert.equal(parseCompassIdentityConfig('not json'), null);
  });

  it('is null when url or token is missing/blank', () => {
    assert.equal(parseCompassIdentityConfig('{"url":"http://x:8000"}'), null);
    assert.equal(parseCompassIdentityConfig('{"token":"abc"}'), null);
    assert.equal(parseCompassIdentityConfig('{"url":"  ","token":"abc"}'), null);
  });
});

describe('isCompassIdentitySyncEnabled', () => {
  it('defaults to enabled when unset', () => {
    assert.equal(isCompassIdentitySyncEnabled({}), true);
  });

  it('is disabled only by the literal string "0"', () => {
    assert.equal(isCompassIdentitySyncEnabled({ VEYLIN_COMPASS_IDENTITY_SYNC: '0' }), false);
    assert.equal(isCompassIdentitySyncEnabled({ VEYLIN_COMPASS_IDENTITY_SYNC: 'false' }), true);
  });
});

describe('desiredCompassEntries (v3 — exactly ONE scene-less entry)', () => {
  it('builds exactly one `compass` entry whose headers carry Authorization ONLY (no x-compass-source)', () => {
    const entries = desiredCompassEntries(CONFIG, ['guolu']);
    assert.equal(entries.length, 1);
    const [compass] = entries;
    assert.equal(compass?.name, COMPASS_ENTRY_NAME);
    assert.equal(compass?.url, 'http://compass.local:8000/mcp/');
    assert.equal(compass?.transport, 'http');
    assert.equal(compass?.enabled, true);
    assert.equal(compass?.managed, true);
    assert.equal(compass?.group, COMPASS_IDENTITY_GROUP);
    // Byte-exact header set: Authorization and NOTHING else. Scene binding is
    // per-connection (pool, Task 4), never on the entry.
    assert.deepEqual(compass?.headers, { Authorization: 'Bearer acct-jwt' });
    assert.ok(!('x-compass-source' in (compass?.headers ?? {})));
  });

  it('is the same single entry regardless of how many sources are granted', () => {
    const one = desiredCompassEntries(CONFIG, ['guolu']);
    const many = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong', 'newfactory']);
    assert.deepEqual(one, many);
    assert.deepEqual(
      many.map((e) => e.name),
      [COMPASS_ENTRY_NAME],
    );
  });

  it('never emits per-scene compass-<source> or compass-对比 names', () => {
    const entries = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong']);
    assert.ok(!entries.some((e) => e.name.startsWith('compass-')));
  });

  it('still yields the single entry at zero granted sources — access control lives at the project layer', () => {
    const entries = desiredCompassEntries(CONFIG, []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, COMPASS_ENTRY_NAME);
  });
});

describe('desiredVsCurrent (pure diff — untouched fn, re-keyed fixtures)', () => {
  it('creates the compass entry when no same-name row exists', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const actions = desiredVsCurrent(desired, []);
    assert.deepEqual(actions, [{ kind: 'create', entry: desired[0] }]);
  });

  it('adopts a manual row a human happened to name `compass` (adopt-by-name unchanged)', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({
        id: 'srv-1',
        name: COMPASS_ENTRY_NAME,
        url: 'https://old-tunnel.example.com/mcp',
        headers: { Authorization: 'Bearer old-per-tenant-jwt' },
      }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [{ kind: 'adopt', id: 'srv-1', entry: desired[0] }]);
  });

  it('is unchanged when the managed compass row already matches exactly', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({
        id: 'srv-1',
        name: COMPASS_ENTRY_NAME,
        url: desired[0]!.url,
        headers: desired[0]!.headers,
        group: desired[0]!.group,
        managed: true,
      }),
    ];
    assert.deepEqual(desiredVsCurrent(desired, current), [{ kind: 'unchanged', id: 'srv-1' }]);
  });

  it('legacy-entry disable matrix: managed compass-guolu/-shangzhong/-对比 all fall into the disable branch; manual rows untouched', () => {
    // These legacy names never equal `compass`, so adopt-by-name cannot capture
    // them — desiredVsCurrent retires them via its ordinary disable branch.
    const desired = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong']);
    const current = [
      server({
        id: 'srv-guolu',
        name: 'compass-guolu',
        url: 'http://compass.local:8000/mcp/',
        headers: { Authorization: 'Bearer acct-jwt', 'x-compass-source': 'guolu' },
        group: COMPASS_IDENTITY_GROUP,
        managed: true,
      }),
      server({
        id: 'srv-shangzhong',
        name: 'compass-shangzhong',
        url: 'http://compass.local:8000/mcp/',
        headers: { Authorization: 'Bearer acct-jwt', 'x-compass-source': 'shangzhong' },
        group: COMPASS_IDENTITY_GROUP,
        managed: true,
      }),
      server({
        id: 'srv-compare',
        name: 'compass-对比',
        url: 'http://compass.local:8000/mcp/',
        headers: { Authorization: 'Bearer acct-jwt', 'x-compass-source': 'guolu,shangzhong' },
        group: COMPASS_IDENTITY_GROUP,
        managed: true,
      }),
      // Manual (unmanaged) row: must stay entirely untouched.
      server({ id: 'srv-github', name: 'github', managed: false }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [
      { kind: 'create', entry: desired[0] },
      { kind: 'disable', id: 'srv-guolu', name: 'compass-guolu' },
      { kind: 'disable', id: 'srv-shangzhong', name: 'compass-shangzhong' },
      { kind: 'disable', id: 'srv-compare', name: 'compass-对比' },
    ]);
  });

  it('leaves already-disabled legacy managed rows alone (no repeat disable)', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({ id: 'srv-guolu', name: 'compass-guolu', managed: true, enabled: false }),
      server({ id: 'srv-compare', name: 'compass-对比', managed: true, enabled: false }),
    ];
    assert.deepEqual(desiredVsCurrent(desired, current), [{ kind: 'create', entry: desired[0] }]);
  });

  it('never touches a MANUAL row that looks like a legacy per-scene entry (unmanaged compass-guolu)', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({ id: 'srv-manual', name: 'compass-guolu', managed: false, enabled: true }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [{ kind: 'create', entry: desired[0] }]);
  });
});

describe('desiredDefaultProjectsVsCurrent (pure default-project sync matrix)', () => {
  it('creates one managed default project per freshly granted source, named via the shared label map', () => {
    const actions = desiredDefaultProjectsVsCurrent(['guolu', 'shangzhong', 'newfactory'], []);
    assert.deepEqual(actions, {
      createProjects: [
        { name: '锅炉厂', source: 'guolu' },
        { name: '上重', source: 'shangzhong' },
        // Unknown source: label falls back to the raw code.
        { name: 'newfactory', source: 'newfactory' },
      ],
      enableProjects: [],
      disableProjects: [],
    });
  });

  it('emits no actions when every granted source already has an enabled managed default', () => {
    const current = [
      project({ id: 'proj-guolu', name: '锅炉厂', sources: ['guolu'] }),
      project({ id: 'proj-shangzhong', name: '上重', sources: ['shangzhong'] }),
    ];
    const actions = desiredDefaultProjectsVsCurrent(['guolu', 'shangzhong'], current);
    assert.deepEqual(actions, { createProjects: [], enableProjects: [], disableProjects: [] });
  });

  it('re-enables (never duplicates) a disabled managed default when its source is re-granted', () => {
    const current = [
      project({ id: 'proj-guolu', name: '锅炉厂', sources: ['guolu'], enabled: false }),
    ];
    const actions = desiredDefaultProjectsVsCurrent(['guolu'], current);
    assert.deepEqual(actions, {
      createProjects: [],
      enableProjects: [{ id: 'proj-guolu', name: '锅炉厂' }],
      disableProjects: [],
    });
  });

  it('disables an enabled managed default whose source grant was revoked — and only once', () => {
    const current = [
      project({ id: 'proj-guolu', name: '锅炉厂', sources: ['guolu'] }),
      project({ id: 'proj-shangzhong', name: '上重', sources: ['shangzhong'] }),
      // Already disabled + still revoked: no repeat action.
      project({ id: 'proj-old', name: 'oldfactory', sources: ['oldfactory'], enabled: false }),
    ];
    const actions = desiredDefaultProjectsVsCurrent(['guolu'], current);
    assert.deepEqual(actions, {
      createProjects: [],
      enableProjects: [],
      disableProjects: [{ id: 'proj-shangzhong', name: '上重' }],
    });
  });

  it('NEVER touches user-composed (managed:false) rows — and still creates the default alongside them', () => {
    const current = [
      // User composed their own single-source guolu project; the managed
      // default is a separate row and must still be created.
      project({ id: 'proj-user', name: '我的锅炉', sources: ['guolu'], managed: false }),
    ];
    const actions = desiredDefaultProjectsVsCurrent(['guolu'], current);
    assert.deepEqual(actions, {
      createProjects: [{ name: '锅炉厂', source: 'guolu' }],
      enableProjects: [],
      disableProjects: [],
    });
  });

  it('leaves a user-composed multi-source row alone even when one of its sources is revoked', () => {
    const current = [
      project({ id: 'proj-guolu', name: '锅炉厂', sources: ['guolu'] }),
      project({
        id: 'proj-compare',
        name: '对比分析',
        sources: ['guolu', 'shangzhong'],
        managed: false,
      }),
    ];
    // shangzhong revoked: the composed row keeps its frozen source set untouched.
    const actions = desiredDefaultProjectsVsCurrent(['guolu'], current);
    assert.deepEqual(actions, { createProjects: [], enableProjects: [], disableProjects: [] });
  });

  it('de-duplicates the grant list and skips anomalous managed multi-source rows', () => {
    const current = [
      // Managed multi-source row: never created by the reconciler; left alone.
      project({ id: 'proj-weird', name: 'weird', sources: ['a', 'b'] }),
    ];
    const actions = desiredDefaultProjectsVsCurrent(['guolu', 'guolu'], current);
    assert.deepEqual(actions, {
      createProjects: [{ name: '锅炉厂', source: 'guolu' }],
      enableProjects: [],
      disableProjects: [],
    });
  });
});

describe('createCompassIdentitySyncLoop', () => {
  it('start()/stop() do not throw and stop() is idempotent', () => {
    const loop = createCompassIdentitySyncLoop({ sync: async () => ({ ...ZERO_SUMMARY }) });
    loop.start();
    loop.stop();
    loop.stop();
  });

  it('tick() calls sync() and swallows a throw instead of propagating it', async () => {
    const warnings: string[] = [];
    let calls = 0;
    const loop = createCompassIdentitySyncLoop({
      sync: async () => {
        calls += 1;
        throw new Error('boom');
      },
      warn: (l) => warnings.push(l),
    });

    await assert.doesNotReject(() => loop.tick());
    assert.equal(calls, 1);
    assert.match(warnings[0] ?? '', /periodic sync threw: boom/);
  });

  it('skips an overlapping tick while a sync is already in flight', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loop = createCompassIdentitySyncLoop({
      sync: async () => {
        calls += 1;
        await gate;
        return { ...ZERO_SUMMARY };
      },
    });

    const first = loop.tick();
    const second = loop.tick();
    await second;
    assert.equal(calls, 1, 'the overlapping tick must be skipped, not queue a second sync');

    release();
    await first;
  });
});

describe('reconcileCompassIdentity — fetch failure is a no-op', () => {
  it('never touches entries OR projects and returns a zero summary when /my/sources fails', async () => {
    const warnings: string[] = [];
    let storeTouched = false;
    const summary = await reconcileCompassIdentity({
      tenantId: DEV_TENANT_ID,
      config: CONFIG,
      fetchSources: async () => ({ ok: false, error: 'ECONNREFUSED' }),
      listRemoteMcpServers: async () => {
        storeTouched = true;
        return [];
      },
      createRemoteMcpServer: async () => {
        storeTouched = true;
        throw new Error('must not be called');
      },
      updateRemoteMcpServer: async () => {
        storeTouched = true;
        throw new Error('must not be called');
      },
      rebuildMcp: async () => {
        storeTouched = true;
      },
      listProjects: async () => {
        storeTouched = true;
        return [];
      },
      createProject: async () => {
        storeTouched = true;
        throw new Error('must not be called');
      },
      updateProject: async () => {
        storeTouched = true;
        throw new Error('must not be called');
      },
      invalidateCompassPool: () => {
        storeTouched = true;
      },
      warn: (l) => warnings.push(l),
      log: () => undefined,
    });

    assert.deepEqual(summary, ZERO_SUMMARY);
    assert.equal(storeTouched, false);
    assert.match(warnings[0] ?? '', /ECONNREFUSED/);
  });
});

describe('reconcileCompassIdentity — integration against the real embedded store', () => {
  before(async () => {
    await connectDb();
    await ensureDevTenant();
  });

  after(async () => {
    await closeDb();
  });

  /** Real project-store bindings shared by every integration reconcile call. */
  const projectDeps = { listProjects, createProject, updateProject };

  it('creates the single compass entry + default projects, disables legacy per-scene rows, and rebuilds', async () => {
    // Own tenant id per test (not DEV_TENANT_ID) — the reconciler diffs against
    // *every* current row for a tenant, so integration tests need full
    // isolation from each other, not just unique names within a shared tenant.
    const suffix = Date.now();
    const tenantId = `compass-identity-test-${suffix}`;
    const untouchedName = `unrelated-${suffix}`;

    // Legacy per-scene managed rows from the pre-v3 reconciler.
    const legacyGuolu = await createRemoteMcpServer(tenantId, {
      name: 'compass-guolu',
      transport: 'http',
      url: 'http://compass.local:8000/mcp/',
      headers: { Authorization: 'Bearer acct-jwt', 'x-compass-source': 'guolu' },
      enabled: true,
      group: COMPASS_IDENTITY_GROUP,
      managed: true,
    });
    const legacyCompare = await createRemoteMcpServer(tenantId, {
      name: 'compass-对比',
      transport: 'http',
      url: 'http://compass.local:8000/mcp/',
      headers: { Authorization: 'Bearer acct-jwt', 'x-compass-source': 'guolu,shangzhong' },
      enabled: true,
      group: COMPASS_IDENTITY_GROUP,
      managed: true,
    });
    // Unrelated manual entry that must be left untouched.
    await createRemoteMcpServer(tenantId, {
      name: untouchedName,
      transport: 'sse',
      url: 'https://example.com/sse',
      headers: {},
      enabled: true,
    });

    let rebuildCalls = 0;
    let invalidateCalls = 0;
    const summary = await reconcileCompassIdentity({
      tenantId,
      config: CONFIG,
      fetchSources: async () => ({ ok: true, sources: ['guolu', 'shangzhong'] }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => {
        rebuildCalls += 1;
      },
      invalidateCompassPool: () => {
        invalidateCalls += 1;
      },
      ...projectDeps,
      log: () => undefined,
      warn: () => undefined,
    });

    assert.equal(summary.created, 1); // the single `compass` entry
    assert.equal(summary.adopted, 0);
    assert.equal(summary.disabled, 2); // both legacy rows
    assert.equal(summary.projectsCreated, 2); // 锅炉厂 + 上重 defaults
    assert.equal(rebuildCalls, 1);
    assert.equal(invalidateCalls, 1);

    const servers = await listRemoteMcpServers(tenantId);

    const compass = servers.find((s) => s.name === COMPASS_ENTRY_NAME);
    assert.equal(compass?.managed, true);
    assert.equal(compass?.enabled, true);
    assert.equal(compass?.group, COMPASS_IDENTITY_GROUP);
    assert.equal(compass?.url, `${CONFIG.url}/mcp/`);
    assert.deepEqual(compass?.headers, { Authorization: 'Bearer acct-jwt' });

    // Legacy-entry auto-disable, verified against the real store.
    const guoluAfter = servers.find((s) => s.id === legacyGuolu.id);
    assert.equal(guoluAfter?.enabled, false);
    assert.equal(guoluAfter?.managed, true); // disabled, never deleted
    const compareAfter = servers.find((s) => s.id === legacyCompare.id);
    assert.equal(compareAfter?.enabled, false);

    const untouched = servers.find((s) => s.name === untouchedName);
    assert.equal(untouched?.enabled, true);
    assert.equal(untouched?.managed, undefined);

    const projects = await listProjects(tenantId);
    const guoluProject = projects.find((p) => p.name === '锅炉厂');
    assert.deepEqual(guoluProject?.sources, ['guolu']);
    assert.equal(guoluProject?.managed, true);
    assert.equal(guoluProject?.enabled, true);
    const shangzhongProject = projects.find((p) => p.name === '上重');
    assert.deepEqual(shangzhongProject?.sources, ['shangzhong']);
    assert.equal(shangzhongProject?.managed, true);
  });

  it('revoke → disable, re-grant → re-enable the SAME default project row (no duplicates)', async () => {
    const suffix = Date.now();
    const tenantId = `compass-identity-test-regrant-${suffix}`;
    const sourceA = `alpha-${suffix}`;
    const sourceB = `beta-${suffix}`;

    const invalidations: number[] = [];
    const deps = (sources: string[], counters: { rebuilds: number }) => ({
      tenantId,
      config: CONFIG,
      fetchSources: async () => ({ ok: true as const, sources }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => {
        counters.rebuilds += 1;
      },
      invalidateCompassPool: () => {
        invalidations.push(1);
      },
      ...projectDeps,
      log: () => undefined,
      warn: () => undefined,
    });

    // Round 1: both granted → entry + 2 default projects created.
    const c1 = { rebuilds: 0 };
    const round1 = await reconcileCompassIdentity(deps([sourceA, sourceB], c1));
    assert.equal(round1.created, 1);
    assert.equal(round1.projectsCreated, 2);
    assert.equal(c1.rebuilds, 1);

    const afterRound1 = await listProjects(tenantId);
    const rowB = afterRound1.find((p) => p.sources.length === 1 && p.sources[0] === sourceB);
    assert.equal(rowB?.enabled, true);

    // Round 2: sourceB revoked → its default project disables. The entry is
    // unchanged, so rebuildMcp must NOT fire — but the pool hook must (a
    // project change alone still invalidates pooled connections).
    const c2 = { rebuilds: 0 };
    const round2 = await reconcileCompassIdentity(deps([sourceA], c2));
    assert.deepEqual(round2, {
      ...ZERO_SUMMARY,
      unchanged: 1,
      projectsDisabled: 1,
    });
    assert.equal(c2.rebuilds, 0);
    assert.equal(invalidations.length, 2);

    const afterRound2 = await listProjects(tenantId);
    const rowBDisabled = afterRound2.find((p) => p.id === rowB?.id);
    assert.equal(rowBDisabled?.enabled, false);
    assert.equal(rowBDisabled?.managed, true); // disabled, never deleted

    // Round 3: sourceB re-granted → the SAME row re-enables; nothing new created.
    const c3 = { rebuilds: 0 };
    const round3 = await reconcileCompassIdentity(deps([sourceA, sourceB], c3));
    assert.deepEqual(round3, {
      ...ZERO_SUMMARY,
      unchanged: 1,
      projectsEnabled: 1,
    });

    const afterRound3 = await listProjects(tenantId);
    const rowsForB = afterRound3.filter((p) => p.sources.length === 1 && p.sources[0] === sourceB);
    assert.equal(rowsForB.length, 1);
    assert.equal(rowsForB[0]?.id, rowB?.id);
    assert.equal(rowsForB[0]?.enabled, true);
  });

  it('steady state: everything already in sync → zero actions, no rebuild, no pool invalidation', async () => {
    const suffix = Date.now();
    const tenantId = `compass-identity-test-steady-${suffix}`;
    const source = `steady-${suffix}`;
    const [entry] = desiredCompassEntries(CONFIG, [source]);
    await createRemoteMcpServer(tenantId, {
      name: entry!.name,
      transport: entry!.transport,
      url: entry!.url,
      headers: entry!.headers,
      enabled: entry!.enabled,
      group: entry!.group,
      managed: true,
    });
    await createProject(tenantId, {
      name: source,
      sources: [source],
      managed: true,
      enabled: true,
    });

    let rebuildCalls = 0;
    let invalidateCalls = 0;
    const summary = await reconcileCompassIdentity({
      tenantId,
      config: CONFIG,
      fetchSources: async () => ({ ok: true, sources: [source] }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => {
        rebuildCalls += 1;
      },
      invalidateCompassPool: () => {
        invalidateCalls += 1;
      },
      ...projectDeps,
      log: () => undefined,
      warn: () => undefined,
    });

    assert.deepEqual(summary, { ...ZERO_SUMMARY, unchanged: 1 });
    assert.equal(rebuildCalls, 0);
    assert.equal(invalidateCalls, 0);
  });

  it('a user-composed project overlapping a revoked source survives the reconcile untouched', async () => {
    const suffix = Date.now();
    const tenantId = `compass-identity-test-composed-${suffix}`;
    const sourceA = `gamma-${suffix}`;
    const sourceB = `delta-${suffix}`;

    // User-composed row spanning both sources (managed:false).
    const composed = await createProject(tenantId, {
      name: `对比-${suffix}`,
      sources: [sourceA, sourceB],
      managed: false,
    });

    // Only sourceA is granted — sourceB is effectively revoked.
    const summary = await reconcileCompassIdentity({
      tenantId,
      config: CONFIG,
      fetchSources: async () => ({ ok: true, sources: [sourceA] }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => undefined,
      ...projectDeps,
      log: () => undefined,
      warn: () => undefined,
    });

    // Only the entry + the sourceA default were materialized; the composed row
    // was neither disabled nor re-sourced.
    assert.equal(summary.created, 1);
    assert.equal(summary.projectsCreated, 1);
    assert.equal(summary.projectsDisabled, 0);

    const projects = await listProjects(tenantId);
    const composedAfter = projects.find((p) => p.id === composed.id);
    assert.equal(composedAfter?.enabled, true);
    assert.equal(composedAfter?.managed, false);
    assert.deepEqual(composedAfter?.sources, [sourceA, sourceB]);
  });
});

// ---------------------------------------------------------------- 你是谁
// 实测到的洞:一个 install 一份 token,同事之间复制了同一份,Compass 眼里就是
// 同一个人。界面上不显示身份,这件事永远不会被发现 —— "权限按人分"会变成一句
// 只在架构图上成立的话。

describe('身份要带回来', () => {
  it('/my/sources 的 username 被读出来', async () => {
    const out = await fetchCompassSources(
      { url: 'http://x', token: 't' }, 1000,
      (async () => ({
        ok: true, status: 200,
        json: async () => ({ username: '张三', sources: ['guolu'] }),
      })) as unknown as typeof fetch,
    );
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.username, '张三');
  });

  it('老版本 Compass 不返 username:不猜、不编,标成未知', async () => {
    const out = await fetchCompassSources(
      { url: 'http://x', token: 't' }, 1000,
      (async () => ({ ok: true, status: 200, json: async () => ({ sources: ['guolu'] }) })) as unknown as typeof fetch,
    );
    assert.equal(out.ok && out.username, undefined);
  });
});
