import type { McpHealthSnapshot } from './mcp-health.js';

/**
 * Self-healing background retry for remote MCP servers.
 *
 * Recurring incident: an ssh tunnel to a remote MCP server (e.g. Compass) blips
 * (mac sleep, network hiccup). `rebuildMcp` at boot/reconnect fails, and without
 * this loop the tenant stays disconnected forever — a human has to notice
 * "Compass 未连接" and POST /api/mcp-servers/reconnect, even though the tunnel
 * is healthy again seconds later.
 *
 * This module is pure orchestration: it reuses the exact same `rebuildMcp`
 * path the manual reconnect route calls (server.ts / routes/mcp.ts) and the
 * exact same `mcpHealthByTenant` snapshot the UI reads. It never talks to MCP
 * itself, which is what makes `createMcpAutoRetryLoop`'s `tick()` testable
 * with a stubbed `rebuildMcp`.
 */

/** Tick interval and per-tenant backoff base: 30s. */
export const MCP_RETRY_BASE_MS = 30_000;
/** Per-tenant backoff ceiling: 300s (5 min). */
export const MCP_RETRY_MAX_MS = 300_000;
/** The loop polls at the same cadence as the backoff base — a tenant that's
 * due fires on the next tick; a tenant that isn't just gets skipped. */
export const MCP_RETRY_INTERVAL_MS = MCP_RETRY_BASE_MS;

export type TenantRetryState = {
  consecutiveFailures: number;
  nextAttemptAt: number;
};

/** VEYLIN_MCP_AUTO_RETRY=0 disables the loop; anything else (including unset) leaves it on. */
export function isMcpAutoRetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VEYLIN_MCP_AUTO_RETRY !== '0';
}

/**
 * True when the snapshot has any disconnected server. `buildMcpHealthSnapshot`
 * is only ever given `activeNames` (already filtered to enabled servers — see
 * `listActiveMcpServerNames`), so every entry here is by construction
 * "enabled but disconnected"; there is no separate enabled/disabled check to make.
 */
export function hasDisconnectedServer(snapshot: McpHealthSnapshot | undefined): boolean {
  return snapshot != null && snapshot.servers.some((s) => !s.connected);
}

/** Exponential backoff by consecutive-failure count: 30s, 60s, 120s, 240s, capped at 300s. */
export function computeBackoffMs(consecutiveFailures: number): number {
  const failures = Math.max(1, consecutiveFailures);
  const delay = MCP_RETRY_BASE_MS * 2 ** (failures - 1);
  return Math.min(delay, MCP_RETRY_MAX_MS);
}

/**
 * Pure decision function: is this tenant due for a retry attempt at `now`?
 * No prior state (never attempted, or reset after a success) means "due now".
 */
export function shouldRetryTenant(state: TenantRetryState | undefined, now: number): boolean {
  if (!state) return true;
  return now >= state.nextAttemptAt;
}

/** Advance a tenant's backoff state after a failed attempt. */
export function recordFailure(consecutiveFailures: number, now: number): TenantRetryState {
  const failures = consecutiveFailures + 1;
  return { consecutiveFailures: failures, nextAttemptAt: now + computeBackoffMs(failures) };
}

export type McpAutoRetryDeps = {
  /** The same live map server.ts hands to routes/mcp.ts — read-only from here. */
  mcpHealthByTenant: Map<string, McpHealthSnapshot>;
  /** The same rebuild function the manual /api/mcp-servers/reconnect route calls. */
  rebuildMcp: (tenantId: string) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
  warn?: (line: string) => void;
};

export type McpAutoRetryLoop = {
  /** Run one pass over every cached tenant, retrying whichever are due. Exposed
   * directly so tests (and the self-scheduling timer below) can drive it. */
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

/**
 * Builds the retry loop. `start()` begins a self-scheduling setTimeout chain
 * at MCP_RETRY_INTERVAL_MS; `tick()` is the pure-orchestration unit tests
 * exercise directly, with a stubbed `rebuildMcp` and a controlled `now()`.
 */
export function createMcpAutoRetryLoop(deps: McpAutoRetryDeps): McpAutoRetryLoop {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: string) => console.info(line));
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const states = new Map<string, TenantRetryState>();
  // Guards against overlapping ticks — a slow/hanging rebuild for one tenant
  // must not let a second tick pile more rebuilds on top of it.
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      // Snapshot tenant ids up front: rebuildMcp mutates mcpHealthByTenant as
      // it runs, and a tick should act on the set of tenants it started with.
      const tenantIds = [...deps.mcpHealthByTenant.keys()];
      for (const tenantId of tenantIds) {
        const snapshot = deps.mcpHealthByTenant.get(tenantId);
        if (!hasDisconnectedServer(snapshot)) {
          // Fully connected (or never had a health snapshot) — cheap no-op,
          // and clears any stale backoff state left over from a past outage.
          states.delete(tenantId);
          continue;
        }
        const state = states.get(tenantId);
        if (!shouldRetryTenant(state, now())) continue;

        const attempt = (state?.consecutiveFailures ?? 0) + 1;
        try {
          await deps.rebuildMcp(tenantId);
        } catch (err) {
          states.set(tenantId, recordFailure(state?.consecutiveFailures ?? 0, now()));
          warn(
            `[mcp-retry] tenant=${tenantId} attempt=${attempt} rebuild threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }

        const result = deps.mcpHealthByTenant.get(tenantId);
        const total = result?.servers.length ?? 0;
        const connected = result?.servers.filter((s) => s.connected).length ?? 0;
        if (hasDisconnectedServer(result)) {
          states.set(tenantId, recordFailure(state?.consecutiveFailures ?? 0, now()));
          log(`[mcp-retry] tenant=${tenantId} attempt=${attempt} connected=${connected}/${total}`);
        } else {
          states.delete(tenantId);
          log(
            `[mcp-retry] tenant=${tenantId} attempt=${attempt} connected=${connected}/${total} recovered`,
          );
        }
      }
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext(): void {
    timer = setTimeout(() => {
      void tick().finally(scheduleNext);
    }, MCP_RETRY_INTERVAL_MS);
    timer.unref?.();
  }

  function start(): void {
    if (timer) return; // already running
    scheduleNext();
  }

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { tick, start, stop };
}
