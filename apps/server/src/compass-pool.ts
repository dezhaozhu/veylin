import { MCPClient } from '@mastra/mcp';
import type { McpServer } from '@veylin/shared';
import { sanitizeMcpToolsets } from './mcp-store.js';

/**
 * Compass client pool — one MCP connection per (tenant, compass entry,
 * scene-set), see docs/superpowers/specs/2026-07-27-project-cognition-v3-design.md
 * §B1 and the Phase B plan Task 4.
 *
 * The single managed `compass` entry (compass-identity.ts) carries only the
 * account `Authorization` header — scene binding happens HERE, per connection,
 * via the `x-compass-source` header composed from the pinned project's source
 * set. Compass connections exist ONLY through this pool: `buildMcpServerConfigs`
 * (mcp-store.ts) skips `COMPASS_IDENTITY_GROUP` entries so no generic client
 * (tenant rebuild, agent-run, mcp-apps freshClient base) ever connects compass
 * headerless.
 *
 * Failure posture (plan risk #3): a connection that cannot be established or
 * listed returns `null` and leaves NOTHING cached — the caller falls back to
 * the honest "compass not connected" path. A stale toolset from a *different*
 * scene-set is never served: the scene-set is part of the pool key, and the
 * key string is produced by the same `sceneSetKey()` that produces the header
 * value, so key and header cannot diverge.
 */

/** Minimal surface of the compass entry the pool consumes. */
export type CompassPoolEntry = Pick<McpServer, 'id' | 'name' | 'url' | 'headers'>;

/** What the pool needs from an MCPClient — narrowed so tests can stub it. */
export type CompassPoolClient = {
  listToolsets(): Promise<Record<string, unknown>>;
  disconnect(): Promise<void>;
};

export type CompassPoolClientFactory = (init: {
  id: string;
  servers: Record<string, unknown>;
}) => CompassPoolClient;

export type CompassPoolDeps = {
  /** Injectable MCPClient factory (compass-identity.ts deps style) — tests stub this. */
  createClient?: CompassPoolClientFactory;
  /** listToolsets timeout — same 15s guard as server.ts's rebuildMcp. */
  listTimeoutMs?: number;
};

const defaultCreateClient: CompassPoolClientFactory = (init) =>
  new MCPClient({ id: init.id, servers: init.servers as never });

/** Mirrors rebuildMcp's guard in server.ts: a hung compass must not stall the caller. */
const LIST_TOOLSETS_TIMEOUT_MS = 15_000;

/**
 * Canonical scene-set identity: sorted, de-duped, comma-joined.
 *
 * Used as BOTH the pool-key component AND the `x-compass-source` header value —
 * one function, single source of truth, so the connection a request reuses can
 * never carry a different scene binding than its key claims (plan risk #3).
 *
 * Deliberately NO trimming/normalization of the members: `sources` comes from
 * the project table (reconciler-written or validated user input). A source with
 * stray whitespace is a bug at the write site, and silently "fixing" it here
 * would make the pool key disagree with what the rest of the system sees.
 */
export function sceneSetKey(sources: string[]): string {
  return Array.from(new Set(sources)).sort().join(',');
}

type PooledCompassConnection = {
  client: CompassPoolClient;
  toolsets: Record<string, unknown>;
};

// Full-string pool key: `${tenantId}::${entry.id}::${sceneSetKey}`. Values are
// build PROMISES so concurrent first requests for the same scene-set share one
// connection attempt instead of racing two clients into existence (and leaking
// the loser). A failed build resolves `null` and is evicted by its own caller —
// `null` is never a cache hit, so the next request retries cleanly.
const pool = new Map<string, Promise<PooledCompassConnection | null>>();

// MCPClient throws "initialized multiple times" on id reuse (see the hostSeq
// workaround in routes/mcp-apps.ts) — every pooled client gets a fresh
// monotonic id, including rebuilds of the same key after invalidation.
let clientSeq = 0;

function poolKey(tenantId: string, entryId: string, sources: string[]): string {
  return `${tenantId}::${entryId}::${sceneSetKey(sources)}`;
}

async function buildPooledConnection(
  tenantId: string,
  entry: CompassPoolEntry,
  sources: string[],
  deps: CompassPoolDeps,
): Promise<PooledCompassConnection | null> {
  const createClient = deps.createClient ?? defaultCreateClient;
  const listTimeoutMs = deps.listTimeoutMs ?? LIST_TOOLSETS_TIMEOUT_MS;
  clientSeq += 1;
  let client: CompassPoolClient | null = null;
  // Same guard as server.ts's rebuildMcp: a hung remote must not stall the
  // caller past 15s. (Unlike rebuildMcp we also clear the timer on the happy
  // path so a successful connect doesn't leave a pending 15s timeout behind.)
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    client = createClient({
      id: `veylin-mcp-pool-${tenantId}-${clientSeq}`,
      servers: {
        [entry.name]: {
          url: new URL(entry.url),
          requestInit: {
            // Entry headers (account Authorization) + the per-connection scene
            // binding. The header value IS the key's scene-set component.
            headers: { ...entry.headers, 'x-compass-source': sceneSetKey(sources) },
          },
        },
      },
    });
    const listed = (await Promise.race([
      client.listToolsets(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`listToolsets timed out after ${listTimeoutMs}ms`)),
          listTimeoutMs,
        );
      }),
    ])) as Record<string, unknown>;
    return { client, toolsets: sanitizeMcpToolsets(listed) };
  } catch (err) {
    console.warn(
      `[compass-pool] connect failed tenant=${tenantId} sources=${sceneSetKey(sources)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await client?.disconnect().catch(() => undefined);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Toolsets for the (tenant, entry, scene-set) connection — keyed by the entry
 * name (`toolsets[entry.name]` = the tool map), same shape as the tenant-level
 * `mcpToolsets` cache so callers can overlay it under the unchanged `compass`
 * key. Cache hit reuses the pooled connection; miss connects with the
 * scene-set header; failure returns `null` with nothing cached (caller must
 * treat it as "compass not connected" — never fall back to another
 * scene-set's toolsets).
 */
export async function getPooledCompassToolsets(
  tenantId: string,
  entry: CompassPoolEntry,
  sources: string[],
  deps: CompassPoolDeps = {},
): Promise<Record<string, unknown> | null> {
  const key = poolKey(tenantId, entry.id, sources);

  const existing = pool.get(key);
  if (existing) {
    const connection = await existing.catch(() => null);
    if (connection) return connection.toolsets;
    // A lingering failed/invalidated-mid-build promise: evict (only if it is
    // still the one we awaited — never clobber a newer build) and rebuild.
    if (pool.get(key) === existing) pool.delete(key);
  }

  const build = buildPooledConnection(tenantId, entry, sources, deps);
  pool.set(key, build);
  const connection = await build.catch(() => null);
  if (!connection) {
    if (pool.get(key) === build) pool.delete(key);
    return null;
  }
  return connection.toolsets;
}

/**
 * Drop every pooled compass connection for the tenant: disconnect each client
 * (awaited, errors swallowed) and evict the entries. Called from server.ts's
 * `rebuildMcp` (entry url/token may have changed) and from the
 * compass-identity reconciler on any entry/project change, so no connection
 * outlives a token or grant change.
 */
export async function invalidateCompassPool(tenantId: string): Promise<void> {
  const prefix = `${tenantId}::`;
  const doomed: Promise<PooledCompassConnection | null>[] = [];
  for (const [key, build] of pool) {
    if (!key.startsWith(prefix)) continue;
    doomed.push(build);
    pool.delete(key);
  }
  for (const build of doomed) {
    const connection = await build.catch(() => null);
    if (connection) await connection.client.disconnect().catch(() => undefined);
  }
}

/**
 * Tool-search index entries for a pooled compass toolset —
 * `{ id: "mcp__<entryName>__<tool>", description }`, the exact convention of
 * server.ts's `indexMcpTools` / toolsets.ts's `filterExternalToolsets` /
 * mcp-scoping.ts's `filterMcpToolIndexToScopedServers`, so pooled compass
 * tools merge seamlessly into `mcpToolIndex` and survive the existing scoped
 * filtering. Tool names are scene-set-independent (any pooled connection
 * yields the same catalog), so any connection's toolsets may feed this.
 */
export function getCompassToolIndexEntries(
  entryName: string,
  toolsets: Record<string, unknown>,
): { id: string; description: string }[] {
  const tools = toolsets[entryName];
  if (!tools || typeof tools !== 'object') return [];
  const out: { id: string; description: string }[] = [];
  for (const [name, tool] of Object.entries(tools as Record<string, unknown>)) {
    const desc = (tool as { description?: string })?.description ?? name;
    out.push({ id: `mcp__${entryName}__${name}`, description: desc });
  }
  return out;
}
