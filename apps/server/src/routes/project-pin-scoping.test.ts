/**
 * Project-pin scoping seams (project-cognition v3, Phase B 5a) against the
 * real embedded store — no HTTP harness exists in this repo (see
 * mcp-apps-scoping.test.ts for the sibling convention), so these are the
 * highest reachable seams:
 *
 * 1. `resolvePinnedProjectScope` (project-store.ts) — the shared prelude that
 *    translates a PROJECT-id pin into the entry-level pin the pure scoping
 *    functions consume. Deny-by-default matrix: missing / foreign-tenant /
 *    disabled pins all resolve to the all-null shape.
 * 2. `resolveChatMcpScope` (routes/chat.ts) — the chat path's composition of
 *    prelude + UNCHANGED pure scoping functions + pooled compass overlay.
 *    Carries the re-keyed versions of the review-hardened guarantees
 *    (mcpEnabled attack, unpinned deny, explicit-off subagent suppression)
 *    plus the NEW pooled-isolation invariant: a pinned request's compass
 *    toolsets come from ITS scene-set connection (key + `x-compass-source`
 *    header) and can never observe another project's scene set; pool failure
 *    means compass is absent entirely (honest refusal), never a fallback.
 * 3. `isValidProjectPin` (routes/threads.ts) — POST /api/project validation,
 *    re-keyed to project ids in Phase B 5b: valid ⇔ null OR an enabled
 *    tenant-owned project id. Its pre-re-key semantics — null always valid,
 *    garbage rejected, only a real pin target accepted, foreign tenant
 *    rejected — carry over unchanged; the pin currency is a project id now.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import { isValidProjectPin } from './threads.js';
import { resolveChatMcpScope } from './chat.js';
import { COMPASS_IDENTITY_GROUP } from '../compass-identity.js';
import { invalidateCompassPool, type CompassPoolClientFactory } from '../compass-pool.js';
import {
  createRemoteMcpServer,
  listActiveMcpServerNames,
  listMcpServerGroups,
} from '../mcp-store.js';
import {
  createProject,
  disableProject,
  resolvePinnedProjectScope,
} from '../project-store.js';
import { ensureDevTenant } from '../tenant.js';

/** Seed one enabled compass-identity entry (the reconciler's single `compass` row). */
async function seedCompassEntry(tenantId: string, name = 'compass') {
  return createRemoteMcpServer(tenantId, {
    name,
    transport: 'http',
    url: 'https://compass.example/mcp/',
    headers: { Authorization: 'Bearer test-token' },
    enabled: true,
    group: COMPASS_IDENTITY_GROUP,
    managed: true,
  });
}

// One DB lifecycle for the whole file (three seams share it).
before(async () => {
  await connectDb();
  await ensureDevTenant();
});

after(async () => {
  await closeDb();
});

describe('resolvePinnedProjectScope (the shared prelude: project-id pin → entry-level pin)', () => {
  it('an unpinned thread (null) resolves to the all-null denied shape', async () => {
    const tenant = `ppsc-prelude-null-${Date.now()}`;
    const scope = await resolvePinnedProjectScope(tenant, null);
    assert.deepEqual(scope, { project: null, entryPin: null, sources: [], entry: null });
  });

  it('an enabled tenant-owned project pin resolves to the enabled compass entry name + the project scene set', async () => {
    const tenant = `ppsc-prelude-ok-${Date.now()}`;
    await seedCompassEntry(tenant);
    const project = await createProject(tenant, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });
    const scope = await resolvePinnedProjectScope(tenant, project.id);
    assert.equal(scope.project?.id, project.id);
    assert.equal(scope.entryPin, 'compass');
    assert.deepEqual(scope.sources, ['guolu']);
    assert.equal(scope.entry?.name, 'compass');
    assert.equal(scope.entry?.headers.Authorization, 'Bearer test-token');
  });

  it('a pin that is not a project id at all denies (all-null)', async () => {
    const tenant = `ppsc-prelude-garbage-${Date.now()}`;
    await seedCompassEntry(tenant);
    const scope = await resolvePinnedProjectScope(tenant, `not-a-project-${Date.now()}`);
    assert.deepEqual(scope, { project: null, entryPin: null, sources: [], entry: null });
  });

  it('a legacy entry-name pin (pre-migration leftover) denies like any other stale pin', async () => {
    const tenant = `ppsc-prelude-legacy-${Date.now()}`;
    await seedCompassEntry(tenant);
    const scope = await resolvePinnedProjectScope(tenant, 'compass-guolu');
    assert.deepEqual(scope, { project: null, entryPin: null, sources: [], entry: null });
  });

  it('a DISABLED project pin denies (all-null) — same posture as unpinned', async () => {
    const tenant = `ppsc-prelude-disabled-${Date.now()}`;
    await seedCompassEntry(tenant);
    const project = await createProject(tenant, { name: '锅炉厂', sources: ['guolu'] });
    await disableProject(tenant, project.id);
    const scope = await resolvePinnedProjectScope(tenant, project.id);
    assert.deepEqual(scope, { project: null, entryPin: null, sources: [], entry: null });
  });

  it('a FOREIGN-tenant project id denies (all-null)', async () => {
    const stamp = Date.now();
    const tenantA = `ppsc-prelude-foreign-a-${stamp}`;
    const tenantB = `ppsc-prelude-foreign-b-${stamp}`;
    await seedCompassEntry(tenantA);
    await seedCompassEntry(tenantB);
    const foreign = await createProject(tenantB, { name: '上重', sources: ['shangzhong'] });
    const scope = await resolvePinnedProjectScope(tenantA, foreign.id);
    assert.deepEqual(scope, { project: null, entryPin: null, sources: [], entry: null });
  });

  it('no enabled compass entry: the project still resolves (display) but entryPin/entry stay null', async () => {
    const tenant = `ppsc-prelude-noentry-${Date.now()}`;
    const project = await createProject(tenant, { name: '锅炉厂', sources: ['guolu'] });
    const scope = await resolvePinnedProjectScope(tenant, project.id);
    assert.equal(scope.project?.id, project.id);
    assert.equal(scope.entryPin, null);
    assert.equal(scope.entry, null);
    assert.deepEqual(scope.sources, ['guolu']);
  });

  it('MORE than one enabled compass-group entry (anomaly): refusal over guessing — entryPin stays null', async () => {
    const tenant = `ppsc-prelude-anomaly-${Date.now()}`;
    await seedCompassEntry(tenant, 'compass');
    await seedCompassEntry(tenant, 'compass-rogue');
    const project = await createProject(tenant, { name: '锅炉厂', sources: ['guolu'] });
    const scope = await resolvePinnedProjectScope(tenant, project.id);
    assert.equal(scope.project?.id, project.id);
    assert.equal(scope.entryPin, null);
    assert.equal(scope.entry, null);
  });
});

describe('resolveChatMcpScope (chat path: prelude + pure scoping + pooled compass overlay)', () => {
  const stamp = Date.now();
  const TENANT = `ppsc-chat-${stamp}`;
  const FAIL_TENANT = `ppsc-chat-fail-${stamp}`;

  let guoluProject: Awaited<ReturnType<typeof createProject>>;
  let shangzhongProject: Awaited<ReturnType<typeof createProject>>;
  let tenantActiveMcp: string[];
  let mcpServerGroups: Record<string, string | undefined>;

  /**
   * Recording MCPClient factory for the REAL pool (deps-injected via
   * `poolDeps`): captures the connection's `x-compass-source` header and
   * serves a toolset whose tool name embeds that header — so a request that
   * receives `tool_guolu` provably got the toolsets of the connection built
   * for ITS scene set, and could not have observed another set's.
   */
  function recordingFactory(
    calls: { id: string; header: string | undefined }[],
    opts: { fail?: boolean } = {},
  ): CompassPoolClientFactory {
    return (init) => {
      const server = (
        init.servers as Record<
          string,
          { url: URL; requestInit?: { headers?: Record<string, string> } }
        >
      )['compass'];
      const header = server?.requestInit?.headers?.['x-compass-source'];
      calls.push({ id: init.id, header });
      return {
        listToolsets: async () => {
          if (opts.fail) throw new Error('compass unreachable');
          return {
            compass: { [`tool_${header}`]: { description: `tool for ${header}` } },
          };
        },
        disconnect: async () => undefined,
      };
    };
  }

  const githubIndexEntry = { id: 'mcp__github__search_issues', description: 'search issues' };

  before(async () => {
    await seedCompassEntry(TENANT);
    await createRemoteMcpServer(TENANT, {
      name: 'github',
      transport: 'http',
      url: 'https://github.example/mcp',
      headers: {},
      enabled: true,
    });
    guoluProject = await createProject(TENANT, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });
    shangzhongProject = await createProject(TENANT, {
      name: '上重',
      sources: ['shangzhong'],
      managed: true,
    });
    // Mirror the route: server-truth names + groups from the real store.
    tenantActiveMcp = await listActiveMcpServerNames(TENANT);
    mcpServerGroups = await listMcpServerGroups(TENANT);
  });

  after(async () => {
    await invalidateCompassPool(TENANT);
    await invalidateCompassPool(FAIL_TENANT);
  });

  it('pooled isolation: each pinned request gets ITS scene-set connection — 锅炉厂 can never observe shangzhong', async () => {
    const calls: { id: string; header: string | undefined }[] = [];
    const poolDeps = { createClient: recordingFactory(calls) };

    const guolu = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: guoluProject.id,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps },
    );
    assert.equal(guolu.scope.entryPin, 'compass');
    assert.equal(guolu.projectPin, guoluProject.id);
    assert.deepEqual([...guolu.activeMcp].sort(), ['compass', 'github']);
    // The connection this request used was built with ITS scene-set header...
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.header, 'guolu');
    // ...and the toolsets it received came from that build, not any other.
    const guoluTools = guolu.compassOverlay?.['compass'] as Record<string, unknown>;
    assert.ok(guoluTools['tool_guolu'], 'guolu-pinned request sees the guolu scene-set toolset');
    assert.equal(guoluTools['tool_shangzhong'], undefined);
    // Tool-search index: pooled compass entries merged next to tenant entries.
    assert.ok(guolu.mcpToolNames.some((e) => e.id === 'mcp__compass__tool_guolu'));
    assert.ok(guolu.mcpToolNames.some((e) => e.id === githubIndexEntry.id));

    const shangzhong = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: shangzhongProject.id,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps },
    );
    assert.equal(shangzhong.projectPin, shangzhongProject.id);
    // A SECOND connection, built for the shangzhong scene set — never a reuse
    // of the guolu one (distinct pool key = distinct client + header).
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.header, 'shangzhong');
    assert.notEqual(calls[1]!.id, calls[0]!.id);
    const szTools = shangzhong.compassOverlay?.['compass'] as Record<string, unknown>;
    assert.ok(szTools['tool_shangzhong']);
    assert.equal(szTools['tool_guolu'], undefined, 'shangzhong pin cannot observe guolu toolsets');
    assert.ok(shangzhong.mcpToolNames.some((e) => e.id === 'mcp__compass__tool_shangzhong'));
    assert.ok(!shangzhong.mcpToolNames.some((e) => e.id === 'mcp__compass__tool_guolu'));

    // Pool reuse stays scene-set-correct: pinning guolu again dials nothing
    // new and still yields the guolu build.
    const guoluAgain = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: guoluProject.id,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps },
    );
    assert.equal(calls.length, 2, 'cache hit — no new connection');
    const againTools = guoluAgain.compassOverlay?.['compass'] as Record<string, unknown>;
    assert.ok(againTools['tool_guolu']);
    assert.equal(againTools['tool_shangzhong'], undefined);
  });

  it('unpinned thread: grouped compass denied entirely, pool never dialed, ungrouped servers untouched', async () => {
    const calls: { id: string; header: string | undefined }[] = [];
    const result = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: null,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps: { createClient: recordingFactory(calls) } },
    );
    assert.equal(result.scope.project, null);
    assert.equal(result.projectPin, null);
    assert.deepEqual(result.activeMcp, ['github']);
    assert.equal(result.compassOverlay, null);
    assert.equal(calls.length, 0, 'no compass connection for an unpinned thread');
    assert.deepEqual(result.scopedMcpServersForSubagents, ['github']);
    assert.ok(!result.mcpToolNames.some((e) => e.id.startsWith('mcp__compass__')));
  });

  it('pin to a DISABLED project: same as unpinned — grouped denied, no auto-pin, no pool dial', async () => {
    const disabled = await createProject(TENANT, { name: '停用厂', sources: ['guolu'] });
    await disableProject(TENANT, disabled.id);
    const calls: { id: string; header: string | undefined }[] = [];
    const result = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: disabled.id,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps: { createClient: recordingFactory(calls) } },
    );
    assert.equal(result.scope.project, null);
    assert.equal(result.projectPin, null);
    assert.deepEqual(result.activeMcp, ['github']);
    assert.equal(result.compassOverlay, null);
    assert.equal(calls.length, 0);
  });

  it('pin to a FOREIGN-tenant project id: denied exactly like unpinned', async () => {
    const foreign = await createProject(FAIL_TENANT, { name: '外租户', sources: ['guolu'] });
    const calls: { id: string; header: string | undefined }[] = [];
    const result = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: foreign.id,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps: { createClient: recordingFactory(calls) } },
    );
    assert.equal(result.scope.project, null);
    assert.deepEqual(result.activeMcp, ['github']);
    assert.equal(result.compassOverlay, null);
    assert.equal(calls.length, 0);
  });

  it('pool failure: compass absent ENTIRELY (active list, tool index, subagent allowlist) — honest refusal, no fallback', async () => {
    await seedCompassEntry(FAIL_TENANT);
    const failProject = await createProject(FAIL_TENANT, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });
    const failActive = await listActiveMcpServerNames(FAIL_TENANT);
    const failGroups = await listMcpServerGroups(FAIL_TENANT);
    const calls: { id: string; header: string | undefined }[] = [];
    const result = await resolveChatMcpScope(
      {
        tenantId: FAIL_TENANT,
        threadProjectPin: failProject.id,
        tenantActiveMcp: failActive,
        mcpServerGroups: failGroups,
        mcpEnabled: undefined,
        mcpToolIndex: [],
      },
      { poolDeps: { createClient: recordingFactory(calls, { fail: true }) } },
    );
    // The connection WAS attempted for the right scene set...
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.header, 'guolu');
    // ...but on failure compass vanishes from every surface of the request.
    assert.equal(result.compassOverlay, null);
    assert.ok(!result.activeMcp.includes('compass'));
    assert.ok(!result.scopedMcpServersForSubagents.includes('compass'));
    assert.ok(!result.mcpToolNames.some((e) => e.id.startsWith('mcp__compass__')));
    // The scope itself still resolved — the refusal is the pool's, not the pin's.
    assert.equal(result.scope.entryPin, 'compass');
    assert.equal(result.projectPin, failProject.id);
  });

  it('mcpEnabled attack + explicit-off suppression: client toggles never reach the scoping decision, off = nothing (never a re-pin)', async () => {
    const calls: { id: string; header: string | undefined }[] = [];
    // The untrusted client claims the pinned compass entry is disabled (the
    // original attack: evict the pin from scoping to force a re-pin) and also
    // toggles the ungrouped github off.
    const result = await resolveChatMcpScope(
      {
        tenantId: TENANT,
        threadProjectPin: guoluProject.id,
        tenantActiveMcp,
        mcpServerGroups,
        mcpEnabled: { compass: false, github: false },
        mcpToolIndex: [githubIndexEntry],
      },
      { poolDeps: { createClient: recordingFactory(calls) } },
    );
    // The scoping DECISION was untouched: the pin still resolved and won its
    // group (no other member surfaced in its place — no re-pin, no auto-pin).
    assert.equal(result.scope.entryPin, 'compass');
    assert.equal(result.projectPin, guoluProject.id);
    // Explicit off is a plain off-switch: no compass tools this turn (and no
    // pointless pool dial for a turn that exposes nothing)...
    assert.deepEqual(result.activeMcp, []);
    assert.equal(result.compassOverlay, null);
    assert.equal(calls.length, 0);
    // ...and the grouped capability's explicit off suppresses it for
    // subagents too, while the UNGROUPED github's client toggle is still
    // ignored for the subagent allowlist (the old regression stays fixed).
    assert.deepEqual(result.scopedMcpServersForSubagents, ['github']);
  });
});

/**
 * POST /api/project pin validation — `isValidProjectPin` is the helper the
 * route calls before persisting a thread's project pin. Re-keyed in Phase B
 * 5b: the pin currency is a PROJECT id (valid ⇔ null OR an enabled
 * tenant-owned project id). The pre-re-key semantics are preserved
 * one-for-one: null always valid; garbage rejected; only a real pin target
 * accepted (a project id now — MCP entry names, the old currency, are
 * garbage); a target belonging to a DIFFERENT tenant rejected. New with
 * project keying: a DISABLED project id is rejected (matches the prelude's
 * deny — persisting it would deny forever).
 */
describe('isValidProjectPin', () => {
  const stamp = Date.now();
  const TENANT = `project-pin-valid-${stamp}`;

  it('null (clearing the pin) is always valid', async () => {
    assert.equal(await isValidProjectPin(TENANT, null), true);
  });

  it('a value that is not a project id at all is rejected', async () => {
    const bogus = `not-a-project-${stamp}`;
    assert.equal(await isValidProjectPin(TENANT, bogus), false);
  });

  it('an MCP entry name — even the tenant\'s real, grouped compass entry — is rejected (entry names are no longer pins)', async () => {
    await createRemoteMcpServer(TENANT, {
      name: 'compass',
      transport: 'http',
      url: 'https://compass.example/mcp/',
      headers: {},
      enabled: true,
      group: COMPASS_IDENTITY_GROUP,
      managed: true,
    });
    assert.equal(await isValidProjectPin(TENANT, 'compass'), false);
    // …and the legacy per-scene pin values (pre-migration leftovers) with it.
    assert.equal(await isValidProjectPin(TENANT, 'compass-guolu'), false);
  });

  it('an enabled tenant-owned project id is accepted', async () => {
    const project = await createProject(TENANT, {
      name: '锅炉厂',
      sources: ['guolu'],
      managed: true,
    });
    assert.equal(await isValidProjectPin(TENANT, project.id), true);
  });

  it('a DISABLED project id is rejected — persisting it would deny scoped access forever', async () => {
    const project = await createProject(TENANT, { name: '停用厂', sources: ['guolu'] });
    await disableProject(TENANT, project.id);
    assert.equal(await isValidProjectPin(TENANT, project.id), false);
  });

  it('a project id owned by a DIFFERENT tenant is rejected', async () => {
    const otherTenant = `project-pin-other-tenant-${stamp}`;
    const foreign = await createProject(otherTenant, { name: '上重', sources: ['shangzhong'] });
    assert.equal(await isValidProjectPin(TENANT, foreign.id), false);
  });
});

/**
 * 实测踩到的越界:项目「111」的数据源写着"这个项目只用你自己的文件",
 * 而 agent 在里面回答了整页 shangzhong 的排产数据。
 *
 * 两边"各自没错"叠出来的:Veylin 对空 sources 照常建连接、场景头是空串;
 * Compass 那边非 account 的旧式 token 按设计忽略场景头,落回自己的租户。
 */
describe('没挂数据源的项目', () => {
  const base = {
    tenantId: 'T',
    threadProjectPin: 'p-empty',
    tenantActiveMcp: ['compass'],
    mcpServerGroups: { compass: 'compass' },
    mcpEnabled: undefined,
    mcpToolIndex: [],
  };
  const pooled = {
    compass: {
      list_my_scenes: { execute: async () => ({}) },
      get_cockpit: { execute: async () => ({}) },
      get_schedule_rows: { execute: async () => ({}) },
    },
  };
  const deps = (sources: string[]) => ({
    resolveScope: async () => ({
      project: { id: 'p-empty', name: '111', sources, managed: false, enabled: true } as never,
      entryPin: 'compass',
      sources,
      entry: { id: 'e1', name: 'compass' } as never,
    }),
    getPooledToolsets: async () => pooled as never,
  });

  it('**读数据的工具一个都不暴露**', async () => {
    const out = await resolveChatMcpScope(base, deps([]) as never);
    const tools = Object.keys((out.compassOverlay?.['compass'] ?? {}) as object);
    assert.ok(!tools.includes('get_cockpit'), `越界了:${tools.join(',')}`);
    assert.ok(!tools.includes('get_schedule_rows'));
  });

  it('**模型连看都看不到那些工具** —— 只是调用报错的话,它会一直重试', async () => {
    const out = await resolveChatMcpScope(base, deps([]) as never);
    assert.ok(!out.mcpToolNames.some((t) => String(t.id).includes('get_cockpit')));
  });

  it('发现类留着 —— 否则"我有哪些数据源可以挂"这条路也断了', async () => {
    const out = await resolveChatMcpScope(base, deps([]) as never);
    assert.ok('list_my_scenes' in ((out.compassOverlay?.['compass'] ?? {}) as object));
  });

  it('挂了数据源的项目一个不动', async () => {
    const out = await resolveChatMcpScope(base, deps(['shangzhong']) as never);
    const tools = Object.keys((out.compassOverlay?.['compass'] ?? {}) as object);
    assert.ok(tools.includes('get_cockpit'));
  });
});
