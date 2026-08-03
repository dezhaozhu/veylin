import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoffMs,
  shouldRetryTenant,
  recordFailure,
  hasDisconnectedServer,
  isMcpAutoRetryEnabled,
  createMcpAutoRetryLoop,
} from './mcp-retry-loop.js';
import type { McpHealthSnapshot } from './mcp-health.js';

describe('computeBackoffMs', () => {
  it('doubles from the 30s base up to the 300s cap', () => {
    assert.equal(computeBackoffMs(1), 30_000);
    assert.equal(computeBackoffMs(2), 60_000);
    assert.equal(computeBackoffMs(3), 120_000);
    assert.equal(computeBackoffMs(4), 240_000);
    assert.equal(computeBackoffMs(5), 300_000); // uncapped would be 480_000
    assert.equal(computeBackoffMs(9), 300_000);
  });

  it('treats a zero/negative failure count as the first attempt', () => {
    assert.equal(computeBackoffMs(0), 30_000);
    assert.equal(computeBackoffMs(-3), 30_000);
  });
});

describe('shouldRetryTenant', () => {
  it('is due immediately with no prior state (first attempt, or reset after success)', () => {
    assert.equal(shouldRetryTenant(undefined, 0), true);
  });

  it('is not due before nextAttemptAt', () => {
    const state = { consecutiveFailures: 1, nextAttemptAt: 1_000 };
    assert.equal(shouldRetryTenant(state, 999), false);
  });

  it('is due at or after nextAttemptAt', () => {
    const state = { consecutiveFailures: 1, nextAttemptAt: 1_000 };
    assert.equal(shouldRetryTenant(state, 1_000), true);
    assert.equal(shouldRetryTenant(state, 1_001), true);
  });
});

describe('recordFailure', () => {
  it('increments the failure count and schedules the next attempt via backoff, reset on success', () => {
    const first = recordFailure(0, 1_000);
    assert.equal(first.consecutiveFailures, 1);
    assert.equal(first.nextAttemptAt, 1_000 + 30_000);

    const second = recordFailure(first.consecutiveFailures, 2_000);
    assert.equal(second.consecutiveFailures, 2);
    assert.equal(second.nextAttemptAt, 2_000 + 60_000);
  });
});

describe('hasDisconnectedServer', () => {
  it('is false for a missing snapshot', () => {
    assert.equal(hasDisconnectedServer(undefined), false);
  });

  it('is false when every server in the snapshot is connected', () => {
    const snap: McpHealthSnapshot = { servers: [{ name: 'a', connected: true, toolCount: 1 }] };
    assert.equal(hasDisconnectedServer(snap), false);
  });

  it('is true when any server in the snapshot is disconnected', () => {
    const snap: McpHealthSnapshot = {
      servers: [
        { name: 'a', connected: true, toolCount: 1 },
        { name: 'b', connected: false, toolCount: 0 },
      ],
    };
    assert.equal(hasDisconnectedServer(snap), true);
  });
});

describe('isMcpAutoRetryEnabled', () => {
  it('defaults to enabled when unset', () => {
    assert.equal(isMcpAutoRetryEnabled({}), true);
  });

  it('is disabled only by the literal string "0"', () => {
    assert.equal(isMcpAutoRetryEnabled({ VEYLIN_MCP_AUTO_RETRY: '0' }), false);
    assert.equal(isMcpAutoRetryEnabled({ VEYLIN_MCP_AUTO_RETRY: 'false' }), true);
    assert.equal(isMcpAutoRetryEnabled({ VEYLIN_MCP_AUTO_RETRY: '' }), true);
  });
});

// --- Orchestration: stub rebuildMcp exactly like server.ts's real one does —
// it mutates mcpHealthByTenant as a side effect — and drive the loop's tick()
// directly with a controlled clock. No real MCP client is involved.
describe('createMcpAutoRetryLoop', () => {
  it('retries an enabled-but-disconnected tenant and the cache reflects recovery on success', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', {
      servers: [{ name: 'compass', connected: false, toolCount: 0, lastError: 'ECONNREFUSED' }],
    });
    let calls = 0;
    const rebuildMcp = async (tenantId: string) => {
      calls += 1;
      assert.equal(tenantId, 't1');
      mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: true, toolCount: 4 }] });
    };
    const logs: string[] = [];
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp,
      now: () => 0,
      log: (l) => logs.push(l),
      warn: (l) => logs.push(l),
    });

    await loop.tick();

    assert.equal(calls, 1);
    assert.equal(mcpHealthByTenant.get('t1')?.servers[0]?.connected, true);
    assert.match(logs[0] ?? '', /attempt=1 connected=1\/1 recovered/);
  });

  it('backs off per tenant on repeated failure and skips attempts before backoff elapses', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: false, toolCount: 0 }] });
    let calls = 0;
    let now = 0;
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp: async () => {
        calls += 1;
        // Still failing — health map keeps reporting disconnected.
      },
      now: () => now,
      log: () => undefined,
      warn: () => undefined,
    });

    await loop.tick(); // attempt 1 @ t=0
    assert.equal(calls, 1);

    now = 10_000; // 10s later, inside the 30s backoff after 1 failure
    await loop.tick();
    assert.equal(calls, 1, 'must not retry before the per-tenant backoff elapses');

    now = 30_000; // backoff elapsed
    await loop.tick();
    assert.equal(calls, 2);

    now = 30_000 + 59_000; // inside the 60s backoff after 2 consecutive failures
    await loop.tick();
    assert.equal(calls, 2);

    now = 30_000 + 60_000; // elapsed
    await loop.tick();
    assert.equal(calls, 3);
  });

  it('resets backoff on success, so a later outage starts back at the base delay', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: false, toolCount: 0 }] });
    let now = 0;
    let succeedNext = false;
    const calls: number[] = [];
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp: async () => {
        calls.push(now);
        mcpHealthByTenant.set('t1', {
          servers: [{ name: 'compass', connected: succeedNext, toolCount: succeedNext ? 1 : 0 }],
        });
      },
      now: () => now,
      log: () => undefined,
      warn: () => undefined,
    });

    await loop.tick(); // fails @ t=0 -> next due @ 30_000
    now = 30_000;
    succeedNext = true;
    await loop.tick(); // succeeds -> state reset

    // A brand new outage right away must retry immediately (no leftover backoff).
    mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: false, toolCount: 0 }] });
    succeedNext = false;
    now = 30_001;
    await loop.tick();

    assert.deepEqual(calls, [0, 30_000, 30_001]);
  });

  it('is a cheap no-op for a tenant that is already fully connected', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: true, toolCount: 3 }] });
    let calls = 0;
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp: async () => {
        calls += 1;
      },
      now: () => 0,
      log: () => undefined,
      warn: () => undefined,
    });

    await loop.tick();

    assert.equal(calls, 0);
  });

  it('skips an overlapping tick while a rebuild is already in flight', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: false, toolCount: 0 }] });
    let calls = 0;
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp: async () => {
        calls += 1;
        await gate;
      },
      now: () => 0,
      log: () => undefined,
      warn: () => undefined,
    });

    const firstTick = loop.tick();
    const secondTick = loop.tick(); // fires while the first tick's rebuild is still pending
    await secondTick;
    assert.equal(calls, 1, 'the overlapping tick must be skipped, not queue a second rebuild');

    releaseFirst();
    await firstTick;
  });

  it('records a failure (without throwing out of tick) when rebuildMcp itself rejects', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', { servers: [{ name: 'compass', connected: false, toolCount: 0 }] });
    const warnings: string[] = [];
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp: async () => {
        throw new Error('boom');
      },
      now: () => 0,
      log: () => undefined,
      warn: (l) => warnings.push(l),
    });

    await assert.doesNotReject(() => loop.tick());
    assert.match(warnings[0] ?? '', /rebuild threw: boom/);
  });

  it('retries each disconnected tenant independently in one tick', async () => {
    const mcpHealthByTenant = new Map<string, McpHealthSnapshot>();
    mcpHealthByTenant.set('t1', { servers: [{ name: 'a', connected: false, toolCount: 0 }] });
    mcpHealthByTenant.set('t2', { servers: [{ name: 'b', connected: true, toolCount: 2 }] });
    const attempted: string[] = [];
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant,
      rebuildMcp: async (tenantId) => {
        attempted.push(tenantId);
        mcpHealthByTenant.set(tenantId, { servers: [{ name: 'a', connected: true, toolCount: 1 }] });
      },
      now: () => 0,
      log: () => undefined,
      warn: () => undefined,
    });

    await loop.tick();

    assert.deepEqual(attempted, ['t1']);
  });

  it('start()/stop() do not throw and stop() is idempotent', () => {
    const loop = createMcpAutoRetryLoop({
      mcpHealthByTenant: new Map(),
      rebuildMcp: async () => undefined,
    });
    loop.start();
    loop.stop();
    loop.stop();
  });
});
