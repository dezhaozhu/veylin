/**
 * Compass client pool — stubbed-MCPClient-factory tests (compass-identity.ts
 * deps style; no network, no DB). The security-critical properties (plan risk
 * #3): one client per (tenant, entry, scene-set); the `x-compass-source`
 * header is byte-produced by the SAME `sceneSetKey()` that keys the pool;
 * failures cache nothing (never a stale different-scene-set toolset); unique
 * client ids (the MCPClient multiple-init gotcha, see routes/mcp-apps.ts).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCompassToolIndexEntries,
  getPooledCompassToolsets,
  invalidateCompassPool,
  sceneSetKey,
  type CompassPoolClientFactory,
} from './compass-pool.js';

const ENTRY = {
  id: 'mcp_server:compass-row',
  name: 'compass',
  url: 'https://compass.example.com/mcp/',
  headers: { Authorization: 'Bearer account-token' },
};

type StubClient = {
  id: string;
  disconnects: number;
  listToolsets: () => Promise<Record<string, unknown>>;
  disconnect: () => Promise<void>;
};

type StubBehavior = 'ok' | 'fail' | 'hang';

/**
 * Records every factory call (`calls`) and every created client (`clients`).
 * `behavior()` is sampled at creation time so a test can flip fail → ok
 * between calls (cache-poisoning retry case).
 */
function stubFactory(behavior: () => StubBehavior = () => 'ok') {
  const calls: { id: string; servers: Record<string, unknown> }[] = [];
  const clients: StubClient[] = [];
  const factory: CompassPoolClientFactory = (init) => {
    calls.push(init);
    const entryName = Object.keys(init.servers)[0]!;
    const mode = behavior();
    const client: StubClient = {
      id: init.id,
      disconnects: 0,
      listToolsets: async () => {
        if (mode === 'hang') return new Promise(() => undefined);
        if (mode === 'fail') throw new Error('connect refused (stub)');
        return {
          [entryName]: {
            get_schedule: { description: '读取排产表' },
            get_gantt: {},
          },
        };
      },
      disconnect: async () => {
        client.disconnects += 1;
      },
    };
    clients.push(client);
    return client;
  };
  return { factory, calls, clients };
}

function headersOf(call: { servers: Record<string, unknown> }, entryName = 'compass') {
  const config = call.servers[entryName] as { requestInit: { headers: Record<string, string> } };
  return config.requestInit.headers;
}

describe('sceneSetKey', () => {
  it('sorts, de-dupes, comma-joins', () => {
    assert.equal(sceneSetKey(['guolu']), 'guolu');
    assert.equal(sceneSetKey(['guolu', 'shangzhong']), 'guolu,shangzhong');
    assert.equal(sceneSetKey(['shangzhong', 'guolu']), 'guolu,shangzhong');
    assert.equal(sceneSetKey(['guolu', 'guolu', 'shangzhong', 'guolu']), 'guolu,shangzhong');
    assert.equal(sceneSetKey([]), '');
  });

  it('does NOT trim whitespace — sources come from the project table; garbage-in is a bug at the write site, and silent normalization here would desync the pool key from the rest of the system', () => {
    assert.equal(sceneSetKey([' guolu']), ' guolu');
    assert.notEqual(sceneSetKey([' guolu']), sceneSetKey(['guolu']));
  });
});

describe('getPooledCompassToolsets', () => {
  it('mints distinct clients per scene-set sharing one entry, with the exact per-set header', async () => {
    const tenant = 'tenant-pool-sets';
    const { factory, calls } = stubFactory();

    const single = await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], {
      createClient: factory,
    });
    const compare = await getPooledCompassToolsets(tenant, ENTRY, ['shangzhong', 'guolu'], {
      createClient: factory,
    });

    assert.ok(single && compare);
    assert.equal(calls.length, 2);
    // Exact header composition: entry headers + x-compass-source = sceneSetKey.
    assert.deepEqual(headersOf(calls[0]!), {
      Authorization: 'Bearer account-token',
      'x-compass-source': 'guolu',
    });
    assert.deepEqual(headersOf(calls[1]!), {
      Authorization: 'Bearer account-token',
      'x-compass-source': 'guolu,shangzhong',
    });
    // Toolsets keyed by the entry name, same shape as the tenant mcpToolsets cache.
    assert.ok((single as Record<string, Record<string, unknown>>).compass?.get_schedule);

    await invalidateCompassPool(tenant);
  });

  it('reuses the pooled connection for a repeated scene-set — factory called once, unsorted/duped input included', async () => {
    const tenant = 'tenant-pool-reuse';
    const { factory, calls } = stubFactory();

    const first = await getPooledCompassToolsets(tenant, ENTRY, ['guolu', 'shangzhong'], {
      createClient: factory,
    });
    const again = await getPooledCompassToolsets(tenant, ENTRY, ['guolu', 'shangzhong'], {
      createClient: factory,
    });
    // Different array, same canonical scene-set → same pooled connection.
    const permuted = await getPooledCompassToolsets(tenant, ENTRY, ['shangzhong', 'guolu', 'guolu'], {
      createClient: factory,
    });

    assert.equal(calls.length, 1);
    assert.equal(again, first);
    assert.equal(permuted, first);

    await invalidateCompassPool(tenant);
  });

  it('shares one build between concurrent first calls for the same key (no racing duplicate clients)', async () => {
    const tenant = 'tenant-pool-concurrent';
    const { factory, calls } = stubFactory();

    const [a, b] = await Promise.all([
      getPooledCompassToolsets(tenant, ENTRY, ['guolu'], { createClient: factory }),
      getPooledCompassToolsets(tenant, ENTRY, ['guolu'], { createClient: factory }),
    ]);

    assert.equal(calls.length, 1);
    assert.ok(a);
    assert.equal(b, a);

    await invalidateCompassPool(tenant);
  });

  it('invalidation disconnects every pooled client for the tenant and the next call rebuilds', async () => {
    const tenant = 'tenant-pool-invalidate';
    const { factory, calls, clients } = stubFactory();

    await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], { createClient: factory });
    await getPooledCompassToolsets(tenant, ENTRY, ['guolu', 'shangzhong'], {
      createClient: factory,
    });
    assert.equal(clients.length, 2);

    await invalidateCompassPool(tenant);
    assert.equal(clients[0]!.disconnects, 1);
    assert.equal(clients[1]!.disconnects, 1);

    const rebuilt = await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], {
      createClient: factory,
    });
    assert.ok(rebuilt);
    assert.equal(calls.length, 3); // rebuilt, not served from a dropped cache

    await invalidateCompassPool(tenant);
  });

  it('invalidation is tenant-scoped — the other tenant keeps its pooled connection', async () => {
    const tenantA = 'tenant-pool-iso-a';
    const tenantB = 'tenant-pool-iso-b';
    const { factory, calls, clients } = stubFactory();

    await getPooledCompassToolsets(tenantA, ENTRY, ['guolu'], { createClient: factory });
    await getPooledCompassToolsets(tenantB, ENTRY, ['guolu'], { createClient: factory });
    assert.equal(calls.length, 2);

    await invalidateCompassPool(tenantA);
    assert.equal(clients[0]!.disconnects, 1);
    assert.equal(clients[1]!.disconnects, 0); // tenant B untouched

    await getPooledCompassToolsets(tenantB, ENTRY, ['guolu'], { createClient: factory });
    assert.equal(calls.length, 2); // still a cache hit for B

    await invalidateCompassPool(tenantB);
  });

  it('every built client gets a unique id — across scene-sets, tenants, AND rebuilds of the same key (MCPClient multiple-init gotcha)', async () => {
    const tenant = 'tenant-pool-ids';
    const { factory, calls } = stubFactory();

    await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], { createClient: factory });
    await getPooledCompassToolsets(tenant, ENTRY, ['shangzhong'], { createClient: factory });
    await invalidateCompassPool(tenant);
    await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], { createClient: factory });

    const ids = calls.map((call) => call.id);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3, `client ids must be unique, got: ${ids.join(', ')}`);

    await invalidateCompassPool(tenant);
  });

  it('failure returns null, caches nothing, and disconnects the partial client — the next call retries and succeeds', async () => {
    const tenant = 'tenant-pool-failure';
    let mode: 'ok' | 'fail' = 'fail';
    const { factory, calls, clients } = stubFactory(() => mode);

    const failed = await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], {
      createClient: factory,
    });
    assert.equal(failed, null);
    assert.equal(clients[0]!.disconnects, 1); // partial client not leaked

    // No cache poisoning: the null result was NOT stored — flip the stub to
    // healthy and the next call must build a fresh client and succeed.
    mode = 'ok';
    const recovered = await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], {
      createClient: factory,
    });
    assert.ok(recovered);
    assert.equal(calls.length, 2);

    await invalidateCompassPool(tenant);
  });

  it('a hung listToolsets hits the timeout race → null, nothing cached', async () => {
    const tenant = 'tenant-pool-hang';
    let mode: StubBehavior = 'hang';
    const { factory, calls } = stubFactory(() => mode);

    const hung = await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], {
      createClient: factory,
      listTimeoutMs: 20,
    });
    assert.equal(hung, null);

    mode = 'ok';
    const recovered = await getPooledCompassToolsets(tenant, ENTRY, ['guolu'], {
      createClient: factory,
      listTimeoutMs: 20,
    });
    assert.ok(recovered);
    assert.equal(calls.length, 2);

    await invalidateCompassPool(tenant);
  });
});

describe('getCompassToolIndexEntries', () => {
  it('builds mcp__<entryName>__<tool> entries, description falling back to the tool name', () => {
    const toolsets = {
      compass: {
        get_schedule: { description: '读取排产表' },
        get_gantt: {},
      },
    };
    assert.deepEqual(getCompassToolIndexEntries('compass', toolsets), [
      { id: 'mcp__compass__get_schedule', description: '读取排产表' },
      { id: 'mcp__compass__get_gantt', description: 'get_gantt' },
    ]);
  });

  it('returns [] when the entry is absent from the toolsets', () => {
    assert.deepEqual(getCompassToolIndexEntries('compass', {}), []);
    assert.deepEqual(getCompassToolIndexEntries('compass', { compass: null }), []);
  });
});
