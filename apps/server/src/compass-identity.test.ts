import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import type { McpServer } from '@veylin/shared';
import {
  COMPASS_COMPARE_ENTRY_NAME,
  COMPASS_IDENTITY_GROUP,
  createCompassIdentitySyncLoop,
  desiredCompassEntries,
  desiredVsCurrent,
  isCompassIdentitySyncEnabled,
  parseCompassIdentityConfig,
  reconcileCompassIdentity,
  type CompassIdentityConfig,
} from './compass-identity.js';
import {
  createRemoteMcpServer,
  listRemoteMcpServers,
  updateRemoteMcpServer,
} from './mcp-store.js';
import { DEV_TENANT_ID, ensureDevTenant } from './tenant.js';

const CONFIG: CompassIdentityConfig = { url: 'http://compass.local:8000', token: 'acct-jwt' };

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

describe('desiredCompassEntries', () => {
  it('builds one compass-<source> entry per granted source, per spec §2.2', () => {
    const entries = desiredCompassEntries(CONFIG, ['guolu']);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['compass-guolu'],
    );
    const [guolu] = entries;
    assert.equal(guolu?.url, 'http://compass.local:8000/mcp/');
    assert.equal(guolu?.transport, 'http');
    assert.equal(guolu?.enabled, true);
    assert.equal(guolu?.managed, true);
    assert.equal(guolu?.group, COMPASS_IDENTITY_GROUP);
    assert.deepEqual(guolu?.headers, {
      Authorization: 'Bearer acct-jwt',
      'x-compass-source': 'guolu',
    });
  });

  it('is empty for an empty grant list', () => {
    assert.deepEqual(desiredCompassEntries(CONFIG, []), []);
  });

  it('below 2 sources: no compass-对比 entry — one granted source stays exactly today\'s shape', () => {
    const entries = desiredCompassEntries(CONFIG, ['guolu']);
    assert.ok(!entries.some((e) => e.name === COMPASS_COMPARE_ENTRY_NAME));
  });

  it('at ≥2 sources, per spec §4, ALSO materializes one compass-对比 entry with every source comma-joined', () => {
    const entries = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong']);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['compass-guolu', 'compass-shangzhong', COMPASS_COMPARE_ENTRY_NAME],
    );
    const compare = entries.find((e) => e.name === COMPASS_COMPARE_ENTRY_NAME);
    assert.equal(compare?.url, 'http://compass.local:8000/mcp/');
    assert.equal(compare?.enabled, true);
    assert.equal(compare?.managed, true);
    assert.equal(compare?.group, COMPASS_IDENTITY_GROUP);
    assert.deepEqual(compare?.headers, {
      Authorization: 'Bearer acct-jwt',
      'x-compass-source': 'guolu,shangzhong',
    });
  });

  it('sorts and de-duplicates the compass-对比 header regardless of grant-list order', () => {
    const entries = desiredCompassEntries(CONFIG, ['shangzhong', 'guolu', 'shangzhong']);
    const compare = entries.find((e) => e.name === COMPASS_COMPARE_ENTRY_NAME);
    assert.equal(compare?.headers['x-compass-source'], 'guolu,shangzhong');
  });

  it('materializes compass-对比 for 3+ sources too, sorted comma-joined', () => {
    const entries = desiredCompassEntries(CONFIG, ['shangzhong', 'guolu', 'newfactory']);
    const compare = entries.find((e) => e.name === COMPASS_COMPARE_ENTRY_NAME);
    assert.equal(compare?.headers['x-compass-source'], 'guolu,newfactory,shangzhong');
  });
});

describe('desiredVsCurrent (pure diff matrix)', () => {
  it('creates entries with no existing same-name row', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const actions = desiredVsCurrent(desired, []);
    assert.deepEqual(actions, [{ kind: 'create', entry: desired[0] }]);
  });

  it('adopts a same-name row whose fields differ — the zero-migration cutover', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({
        id: 'srv-1',
        name: 'compass-guolu',
        url: 'https://old-tunnel.example.com/mcp',
        headers: { Authorization: 'Bearer old-per-tenant-jwt' },
        // Not managed yet — this is exactly today's manual compass-guolu entry.
      }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [{ kind: 'adopt', id: 'srv-1', entry: desired[0] }]);
  });

  it('adopts a previously-managed row whose fields drifted (e.g. url changed)', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({
        id: 'srv-1',
        name: 'compass-guolu',
        url: 'http://compass.local:8000/mcp/',
        headers: { Authorization: 'Bearer stale-token', 'x-compass-source': 'guolu' },
        group: COMPASS_IDENTITY_GROUP,
        managed: true,
      }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [{ kind: 'adopt', id: 'srv-1', entry: desired[0] }]);
  });

  it('is unchanged when a managed row already matches the desired entry exactly', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu']);
    const current = [
      server({
        id: 'srv-1',
        name: 'compass-guolu',
        url: desired[0]!.url,
        headers: desired[0]!.headers,
        group: desired[0]!.group,
        managed: true,
      }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [{ kind: 'unchanged', id: 'srv-1' }]);
  });

  it('disables a managed, enabled row whose source is no longer granted', () => {
    const current = [
      server({
        id: 'srv-1',
        name: 'compass-shangzhong',
        managed: true,
        enabled: true,
        group: COMPASS_IDENTITY_GROUP,
      }),
    ];
    const actions = desiredVsCurrent([], current);
    assert.deepEqual(actions, [{ kind: 'disable', id: 'srv-1', name: 'compass-shangzhong' }]);
  });

  it('leaves an already-disabled managed row alone (no repeat disable action)', () => {
    const current = [
      server({ id: 'srv-1', name: 'compass-shangzhong', managed: true, enabled: false }),
    ];
    assert.deepEqual(desiredVsCurrent([], current), []);
  });

  it('never touches a manual (unmanaged) row that merely shares no name with any desired entry', () => {
    const current = [
      server({ id: 'srv-1', name: 'some-other-server', managed: false, enabled: true }),
    ];
    assert.deepEqual(desiredVsCurrent([], current), []);
  });

  it('mixes create + adopt + disable + unchanged in one pass (2+ sources also creates compass-对比)', () => {
    const desired = desiredCompassEntries(CONFIG, ['guolu', 'newfactory']);
    const current = [
      // guolu: already fully in sync -> unchanged
      server({
        id: 'srv-guolu',
        name: 'compass-guolu',
        url: desired[0]!.url,
        headers: desired[0]!.headers,
        group: desired[0]!.group,
        managed: true,
      }),
      // shangzhong: managed, grant revoked -> disable
      server({ id: 'srv-shangzhong', name: 'compass-shangzhong', managed: true, enabled: true }),
      // an unrelated manual server -> left alone
      server({ id: 'srv-other', name: 'github', managed: false }),
    ];
    const actions = desiredVsCurrent(desired, current);
    assert.deepEqual(actions, [
      { kind: 'unchanged', id: 'srv-guolu' },
      { kind: 'create', entry: desired[1] },
      { kind: 'create', entry: desired[2] }, // compass-对比, materialized because 2 sources are granted
      { kind: 'disable', id: 'srv-shangzhong', name: 'compass-shangzhong' },
    ]);
    assert.equal(desired[2]?.name, COMPASS_COMPARE_ENTRY_NAME);
  });

  describe('compass-对比 (spec §4 — the multi-scene comparison project)', () => {
    it('creates compass-对比 once a tenant crosses to 2 granted sources', () => {
      const desired = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong']);
      const actions = desiredVsCurrent(desired, []);
      const compareAction = actions.find(
        (a) => 'entry' in a && a.entry.name === COMPASS_COMPARE_ENTRY_NAME,
      );
      assert.deepEqual(compareAction, {
        kind: 'create',
        entry: desired.find((e) => e.name === COMPASS_COMPARE_ENTRY_NAME),
      });
    });

    it('adopts (header update) when the granted source set changes under an existing compass-对比 row', () => {
      const desired = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong', 'newfactory']);
      const compareDesired = desired.find((e) => e.name === COMPASS_COMPARE_ENTRY_NAME)!;
      const current = [
        server({
          id: 'srv-compare',
          name: COMPASS_COMPARE_ENTRY_NAME,
          url: compareDesired.url,
          // Stale header: the previous 2-source set, before newfactory was granted.
          headers: {
            Authorization: 'Bearer acct-jwt',
            'x-compass-source': 'guolu,shangzhong',
          },
          group: COMPASS_IDENTITY_GROUP,
          managed: true,
        }),
      ];
      const actions = desiredVsCurrent(desired, current);
      const compareAction = actions.find((a) => a.kind === 'adopt');
      assert.deepEqual(compareAction, { kind: 'adopt', id: 'srv-compare', entry: compareDesired });
      assert.equal(compareDesired.headers['x-compass-source'], 'guolu,newfactory,shangzhong');
    });

    it('disables a managed, enabled compass-对比 row once sources drop back below 2', () => {
      // Only one source left granted -> desiredCompassEntries no longer includes
      // compass-对比 at all, so it is diffed exactly like a revoked scene.
      const desired = desiredCompassEntries(CONFIG, ['guolu']);
      const current = [
        server({
          id: 'srv-compare',
          name: COMPASS_COMPARE_ENTRY_NAME,
          managed: true,
          enabled: true,
          group: COMPASS_IDENTITY_GROUP,
        }),
      ];
      const actions = desiredVsCurrent(desired, current);
      assert.deepEqual(
        actions.filter((a) => 'id' in a && a.id === 'srv-compare'),
        [{ kind: 'disable', id: 'srv-compare', name: COMPASS_COMPARE_ENTRY_NAME }],
      );
    });

    it('adopts a plain manual same-name row exactly like any other scene entry — the zero-migration cutover applies here too', () => {
      const desired = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong']);
      const compareDesired = desired.find((e) => e.name === COMPASS_COMPARE_ENTRY_NAME)!;
      const current = [
        server({
          id: 'srv-manual-compare',
          name: COMPASS_COMPARE_ENTRY_NAME,
          url: 'https://old-tunnel.example.com/mcp',
          headers: { Authorization: 'Bearer old-per-tenant-jwt' },
          // Not managed — a human happened to name a manual server compass-对比.
        }),
      ];
      const actions = desiredVsCurrent(desired, current);
      const compareAction = actions.find((a) => 'id' in a && a.id === 'srv-manual-compare');
      assert.deepEqual(compareAction, {
        kind: 'adopt',
        id: 'srv-manual-compare',
        entry: compareDesired,
      });
    });
  });
});

describe('createCompassIdentitySyncLoop', () => {
  it('start()/stop() do not throw and stop() is idempotent', () => {
    const loop = createCompassIdentitySyncLoop({ sync: async () => ({
      created: 0,
      adopted: 0,
      disabled: 0,
      unchanged: 0,
    }) });
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
        return { created: 0, adopted: 0, disabled: 0, unchanged: 0 };
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
  it('never touches the store and returns a zero summary when /my/sources fails', async () => {
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
      warn: (l) => warnings.push(l),
      log: () => undefined,
    });

    assert.deepEqual(summary, { created: 0, adopted: 0, disabled: 0, unchanged: 0 });
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

  it('creates missing entries, adopts a same-name manual entry, disables a revoked one, and rebuilds', async () => {
    // Own tenant id per test (not DEV_TENANT_ID) — the reconciler diffs against
    // *every* current row for a tenant, so integration tests need full
    // isolation from each other, not just unique names within a shared tenant.
    const suffix = Date.now();
    const tenantId = `compass-identity-test-${suffix}`;
    const manualName = `compass-guolu-${suffix}`;
    const revokedName = `compass-shangzhong-${suffix}`;
    const untouchedName = `unrelated-${suffix}`;

    // Pre-existing manual entry sharing the name of a to-be-desired server.
    await createRemoteMcpServer(tenantId, {
      name: manualName,
      transport: 'http',
      url: 'https://old-tunnel.example.com/mcp',
      headers: { Authorization: 'Bearer old-per-tenant-jwt' },
      enabled: true,
    });
    // Pre-existing managed entry whose source is about to vanish from the grant list.
    const revoked = await createRemoteMcpServer(tenantId, {
      name: revokedName,
      transport: 'http',
      url: 'http://compass.local:8000/mcp/',
      headers: { Authorization: 'Bearer acct-jwt', 'x-compass-source': revokedName },
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
    const config: CompassIdentityConfig = { url: 'http://compass.local:8000', token: 'acct-jwt' };
    const grantedSources = [manualName.replace('compass-', ''), `new-${suffix}`];
    const summary = await reconcileCompassIdentity({
      tenantId,
      config,
      // Grants: the manual entry's source (adopt) plus a brand-new source (create).
      // The revoked entry's source is intentionally absent (disable). Two
      // sources granted also exercises spec §4: a fresh compass-对比 row is
      // created alongside compass-<new-source> (summary.created == 2).
      fetchSources: async () => ({ ok: true, sources: grantedSources }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => {
        rebuildCalls += 1;
      },
      log: () => undefined,
      warn: () => undefined,
    });

    assert.equal(summary.created, 2);
    assert.equal(summary.adopted, 1);
    assert.equal(summary.disabled, 1);
    assert.equal(rebuildCalls, 1);

    const after = await listRemoteMcpServers(tenantId);

    const adopted = after.find((s) => s.name === manualName);
    assert.equal(adopted?.managed, true);
    assert.equal(adopted?.url, `${config.url}/mcp/`);
    assert.equal(adopted?.headers['x-compass-source'], manualName.replace('compass-', ''));
    assert.equal(adopted?.group, COMPASS_IDENTITY_GROUP);

    const created = after.find((s) => s.name === `compass-new-${suffix}`);
    assert.equal(created?.managed, true);
    assert.equal(created?.enabled, true);

    const compare = after.find((s) => s.name === COMPASS_COMPARE_ENTRY_NAME);
    assert.equal(compare?.managed, true);
    assert.equal(compare?.enabled, true);
    assert.equal(compare?.group, COMPASS_IDENTITY_GROUP);
    assert.deepEqual(
      compare?.headers['x-compass-source']?.split(','),
      [...grantedSources].sort(),
    );

    const disabled = after.find((s) => s.id === revoked.id);
    assert.equal(disabled?.enabled, false);
    assert.equal(disabled?.managed, true); // disabled, never deleted, still managed

    const untouched = after.find((s) => s.name === untouchedName);
    assert.equal(untouched?.enabled, true);
    assert.equal(untouched?.managed, undefined);
  });

  it('disables compass-对比 once the source grant list drops back below 2 (adoption/drop symmetry)', async () => {
    const suffix = Date.now();
    const tenantId = `compass-identity-test-compare-${suffix}`;
    const sourceA = `alpha-${suffix}`;
    const sourceB = `beta-${suffix}`;
    const config: CompassIdentityConfig = { url: 'http://compass.local:8000', token: 'acct-jwt' };

    // Round 1: both sources granted -> compass-对比 gets created.
    const round1 = await reconcileCompassIdentity({
      tenantId,
      config,
      fetchSources: async () => ({ ok: true, sources: [sourceA, sourceB] }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    });
    assert.equal(round1.created, 3); // sourceA, sourceB, compass-对比

    const afterRound1 = await listRemoteMcpServers(tenantId);
    const compareAfterRound1 = afterRound1.find((s) => s.name === COMPASS_COMPARE_ENTRY_NAME);
    assert.equal(compareAfterRound1?.enabled, true);
    assert.equal(compareAfterRound1?.managed, true);

    // Round 2: sourceB's grant is revoked -> only 1 source left -> compass-对比 disables.
    const round2 = await reconcileCompassIdentity({
      tenantId,
      config,
      fetchSources: async () => ({ ok: true, sources: [sourceA] }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
    });
    assert.equal(round2.disabled, 2); // compass-<sourceB> and compass-对比

    const afterRound2 = await listRemoteMcpServers(tenantId);
    const compareAfterRound2 = afterRound2.find((s) => s.name === COMPASS_COMPARE_ENTRY_NAME);
    assert.equal(compareAfterRound2?.enabled, false);
    assert.equal(compareAfterRound2?.managed, true); // disabled, never deleted
  });

  it('does not call rebuildMcp when every entry is already unchanged', async () => {
    const suffix = Date.now();
    const tenantId = `compass-identity-test-steady-${suffix}`;
    const source = `steady-${suffix}`;
    const config: CompassIdentityConfig = { url: 'http://compass.local:8000', token: 'acct-jwt' };
    const [entry] = desiredCompassEntries(config, [source]);
    await createRemoteMcpServer(tenantId, {
      name: entry!.name,
      transport: entry!.transport,
      url: entry!.url,
      headers: entry!.headers,
      enabled: entry!.enabled,
      group: entry!.group,
      managed: true,
    });

    let rebuildCalls = 0;
    const summary = await reconcileCompassIdentity({
      tenantId,
      config,
      fetchSources: async () => ({ ok: true, sources: [source] }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => {
        rebuildCalls += 1;
      },
      log: () => undefined,
      warn: () => undefined,
    });

    assert.deepEqual(summary, { created: 0, adopted: 0, disabled: 0, unchanged: 1 });
    assert.equal(rebuildCalls, 0);
  });
});
