import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDb, connectDb } from '@veylin/db';
import type { McpServer } from '@veylin/shared';
import {
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
    const entries = desiredCompassEntries(CONFIG, ['guolu', 'shangzhong']);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['compass-guolu', 'compass-shangzhong'],
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

  it('mixes create + adopt + disable + unchanged in one pass', () => {
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
      { kind: 'disable', id: 'srv-shangzhong', name: 'compass-shangzhong' },
    ]);
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
    const summary = await reconcileCompassIdentity({
      tenantId,
      config,
      // Grants: the manual entry's source (adopt) plus a brand-new source (create).
      // The revoked entry's source is intentionally absent (disable).
      fetchSources: async () => ({
        ok: true,
        sources: [manualName.replace('compass-', ''), `new-${suffix}`],
      }),
      listRemoteMcpServers,
      createRemoteMcpServer,
      updateRemoteMcpServer,
      rebuildMcp: async () => {
        rebuildCalls += 1;
      },
      log: () => undefined,
      warn: () => undefined,
    });

    assert.equal(summary.created, 1);
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

    const disabled = after.find((s) => s.id === revoked.id);
    assert.equal(disabled?.enabled, false);
    assert.equal(disabled?.managed, true); // disabled, never deleted, still managed

    const untouched = after.find((s) => s.name === untouchedName);
    assert.equal(untouched?.enabled, true);
    assert.equal(untouched?.managed, undefined);
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
