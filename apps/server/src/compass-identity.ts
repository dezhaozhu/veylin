import type { McpServer, McpServerInput } from '@veylin/shared';

/**
 * Auto-materializes MCP server entries from a single unified Compass account
 * identity — see docs/superpowers/specs/2026-07-27-unified-compass-identity-design.md §2.
 *
 * `VEYLIN_COMPASS_IDENTITY` carries one account-level `{url, token}` pair.
 * `GET {url}/my/sources` (Compass side, already deployed) returns the list of
 * data-source "scenes" that account is granted. This module turns that list
 * into `compass-<source>` MCP server rows — creating new ones, *adopting*
 * same-name manual rows in place (the zero-migration cutover: today's
 * `compass-guolu`/`compass-shangzhong` entries just get their headers swapped
 * to the account+scene form), and disabling (never deleting) managed rows
 * whose source grant has been revoked.
 *
 * Cross-scene sessions (see
 * docs/superpowers/specs/2026-07-27-cross-scene-design.md §4): once a tenant
 * has ≥2 granted sources, one extra managed `compass-对比` entry is also
 * materialized — same url, `x-compass-source` carrying every source
 * comma-joined — so a single MCP session can bind the whole scene set. It
 * rides the exact same create/adopt/disable machinery as any other entry.
 *
 * Mirrors mcp-retry-loop.ts's shape: a pure decision function
 * (`desiredVsCurrent`) that unit tests drive directly, plus an orchestration
 * function (`reconcileCompassIdentity`) that takes its collaborators as
 * `deps` so tests can stub the network call and the store.
 */

export const COMPASS_IDENTITY_GROUP = 'compass-proj';

/** Boot + refresh-route + self-scheduling interval: 10 minutes. */
export const COMPASS_IDENTITY_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export type CompassIdentityConfig = {
  url: string;
  token: string;
};

/**
 * Parse `VEYLIN_COMPASS_IDENTITY` — a JSON object `{"url": "...", "token": "..."}`.
 * Absent env var → feature off, logs nothing (this is the common case: most
 * deployments don't have a Compass account identity configured). A *present
 * but malformed* value is a misconfiguration and gets one warning.
 */
export function parseCompassIdentityConfig(
  raw = process.env.VEYLIN_COMPASS_IDENTITY?.trim() ?? '',
): CompassIdentityConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const url = (parsed as Record<string, unknown>).url;
      const token = (parsed as Record<string, unknown>).token;
      if (typeof url === 'string' && url.trim() && typeof token === 'string' && token.trim()) {
        return { url: url.trim().replace(/\/+$/, ''), token: token.trim() };
      }
    }
    console.warn(
      '[compass-identity] VEYLIN_COMPASS_IDENTITY must be JSON {"url","token"}; feature stays off',
    );
    return null;
  } catch {
    console.warn('[compass-identity] VEYLIN_COMPASS_IDENTITY is not valid JSON; feature stays off');
    return null;
  }
}

/** VEYLIN_COMPASS_IDENTITY_SYNC=0 disables the boot/interval sync; anything else (including unset) leaves it on. */
export function isCompassIdentitySyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VEYLIN_COMPASS_IDENTITY_SYNC !== '0';
}

export type CompassSourcesResult =
  | { ok: true; sources: string[] }
  | { ok: false; error: string };

/** `GET {url}/my/sources` with the account bearer token — 10s timeout. */
export async function fetchCompassSources(
  config: CompassIdentityConfig,
  timeoutMs = 10_000,
): Promise<CompassSourcesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.url}/my/sources`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `GET /my/sources returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { sources?: unknown };
    if (!Array.isArray(body.sources)) {
      return { ok: false, error: '/my/sources response missing a "sources" array' };
    }
    return { ok: true, sources: body.sources.filter((s): s is string => typeof s === 'string') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export type DesiredCompassEntry = {
  name: string;
  transport: 'http';
  url: string;
  headers: Record<string, string>;
  enabled: true;
  group: string;
  managed: true;
};

/** Managed name of the auto-materialized multi-scene comparison entry, spec §4. */
export const COMPASS_COMPARE_ENTRY_NAME = 'compass-对比';

/**
 * Desired MCP server entries per spec §2.2, one per granted source, PLUS
 * (spec §4) one extra managed `compass-对比` entry once the tenant has ≥2
 * granted sources — same url, but its `x-compass-source` header carries the
 * full sorted, de-duplicated, comma-joined source list, matching the
 * multi-scene session binding the Compass side accepts (§1). Below 2 sources
 * the entry is simply absent from `desired`, so `desiredVsCurrent` disables
 * any previously-materialized one the same way it disables a revoked scene.
 */
export function desiredCompassEntries(
  config: CompassIdentityConfig,
  sources: string[],
): DesiredCompassEntry[] {
  const entries = sources.map((source) => ({
    name: `compass-${source}`,
    transport: 'http' as const,
    url: `${config.url}/mcp/`,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'x-compass-source': source,
    },
    enabled: true as const,
    group: COMPASS_IDENTITY_GROUP,
    managed: true as const,
  }));

  const uniqueSources = Array.from(new Set(sources));
  if (uniqueSources.length >= 2) {
    entries.push({
      name: COMPASS_COMPARE_ENTRY_NAME,
      transport: 'http',
      url: `${config.url}/mcp/`,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'x-compass-source': uniqueSources.sort().join(','),
      },
      enabled: true,
      group: COMPASS_IDENTITY_GROUP,
      managed: true,
    });
  }

  return entries;
}

export type CompassDiffAction =
  | { kind: 'create'; entry: DesiredCompassEntry }
  | { kind: 'adopt'; id: string; entry: DesiredCompassEntry }
  | { kind: 'disable'; id: string; name: string }
  | { kind: 'unchanged'; id: string };

function headersEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function matchesDesired(existing: McpServer, entry: DesiredCompassEntry): boolean {
  return (
    existing.url === entry.url &&
    existing.enabled === entry.enabled &&
    existing.group === entry.group &&
    existing.managed === true &&
    headersEqual(existing.headers, entry.headers)
  );
}

/**
 * Pure diff: desired entries (from the current /my/sources grant list) vs.
 * whatever remote MCP server rows already exist for the tenant.
 *
 * - No existing row with that name → `create`.
 * - An existing row with that name, already matching → `unchanged` (no-op,
 *   including manual rows a human might have hand-edited to look identical —
 *   there's nothing to adopt because there's nothing to change).
 * - An existing row with that name, not matching (including a plain manual
 *   entry that predates this feature) → `adopt`: overwritten in place and
 *   marked managed. This is the zero-migration cutover — same-name manual
 *   `compass-guolu` style entries get their auth swapped transparently.
 * - A `managed` row whose name is no longer in the desired set (source grant
 *   revoked) and is still `enabled` → `disable`. Never touched once already
 *   disabled, and never touched (create/adopt/disable) if NOT managed — a
 *   manual entry that merely shares no name with any desired entry is left
 *   alone entirely.
 */
export function desiredVsCurrent(
  desired: DesiredCompassEntry[],
  current: McpServer[],
): CompassDiffAction[] {
  const byName = new Map(current.map((server) => [server.name, server]));
  const desiredNames = new Set(desired.map((entry) => entry.name));
  const actions: CompassDiffAction[] = [];

  for (const entry of desired) {
    const existing = byName.get(entry.name);
    if (!existing) {
      actions.push({ kind: 'create', entry });
    } else if (matchesDesired(existing, entry)) {
      actions.push({ kind: 'unchanged', id: existing.id });
    } else {
      actions.push({ kind: 'adopt', id: existing.id, entry });
    }
  }

  for (const server of current) {
    if (desiredNames.has(server.name)) continue;
    if (!server.managed) continue;
    if (!server.enabled) continue;
    actions.push({ kind: 'disable', id: server.id, name: server.name });
  }

  return actions;
}

export type CompassIdentitySummary = {
  created: number;
  adopted: number;
  disabled: number;
  unchanged: number;
};

export type CompassIdentityDeps = {
  tenantId: string;
  config: CompassIdentityConfig;
  fetchSources?: (config: CompassIdentityConfig) => Promise<CompassSourcesResult>;
  listRemoteMcpServers: (tenantId: string) => Promise<McpServer[]>;
  createRemoteMcpServer: (tenantId: string, input: McpServerInput) => Promise<McpServer>;
  updateRemoteMcpServer: (
    tenantId: string,
    id: string,
    patch: Partial<McpServerInput> & { managed?: boolean | null },
  ) => Promise<McpServer | null>;
  /** The same rebuild function the manual /api/mcp-servers/reconnect route calls. */
  rebuildMcp: (tenantId: string) => Promise<void>;
  log?: (line: string) => void;
  warn?: (line: string) => void;
};

const emptySummary = (): CompassIdentitySummary => ({
  created: 0,
  adopted: 0,
  disabled: 0,
  unchanged: 0,
});

/**
 * Fetch /my/sources, diff against the store, and apply. Never destructive on
 * fetch failure — logs one line and leaves every existing entry untouched.
 * Triggers the same rebuild/reconnect path the manual reconnect route uses
 * whenever anything actually changed.
 */
export async function reconcileCompassIdentity(
  deps: CompassIdentityDeps,
): Promise<CompassIdentitySummary> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const fetchSources = deps.fetchSources ?? fetchCompassSources;

  const result = await fetchSources(deps.config);
  if (!result.ok) {
    warn(`[compass-identity] tenant=${deps.tenantId} GET /my/sources failed: ${result.error}`);
    return emptySummary();
  }

  const desired = desiredCompassEntries(deps.config, result.sources);
  const current = await deps.listRemoteMcpServers(deps.tenantId);
  const actions = desiredVsCurrent(desired, current);

  const summary = emptySummary();
  let changed = false;

  for (const action of actions) {
    switch (action.kind) {
      case 'create': {
        const entry = action.entry;
        await deps.createRemoteMcpServer(deps.tenantId, {
          name: entry.name,
          transport: entry.transport,
          url: entry.url,
          headers: entry.headers,
          enabled: entry.enabled,
          group: entry.group,
          managed: true,
        });
        summary.created += 1;
        changed = true;
        break;
      }
      case 'adopt': {
        const entry = action.entry;
        await deps.updateRemoteMcpServer(deps.tenantId, action.id, {
          url: entry.url,
          headers: entry.headers,
          enabled: entry.enabled,
          group: entry.group,
          managed: true,
        });
        summary.adopted += 1;
        changed = true;
        break;
      }
      case 'disable': {
        await deps.updateRemoteMcpServer(deps.tenantId, action.id, { enabled: false });
        summary.disabled += 1;
        changed = true;
        break;
      }
      case 'unchanged': {
        summary.unchanged += 1;
        break;
      }
    }
  }

  if (changed) {
    await deps.rebuildMcp(deps.tenantId);
  }
  log(
    `[compass-identity] tenant=${deps.tenantId} created=${summary.created} adopted=${summary.adopted} ` +
      `disabled=${summary.disabled} unchanged=${summary.unchanged}`,
  );
  return summary;
}

export type CompassIdentitySyncLoopDeps = {
  /** Runs one reconcile pass — server.ts binds this to `reconcileCompassIdentity` with real deps. */
  sync: () => Promise<CompassIdentitySummary>;
  intervalMs?: number;
  warn?: (line: string) => void;
};

export type CompassIdentitySyncLoop = {
  /** One pass, exposed directly for tests (mirrors mcp-retry-loop's `tick`). */
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

/**
 * Self-scheduling setTimeout chain, same shape as mcp-retry-loop.ts's
 * start()/stop(): boot calls `sync()` once directly, this loop covers the
 * recurring 10-minute tick. A tick already in flight is never doubled up, and
 * a throw from `sync()` (unexpected — reconcileCompassIdentity handles its
 * own fetch/store errors) is swallowed so one bad tick can't kill the timer.
 */
export function createCompassIdentitySyncLoop(
  deps: CompassIdentitySyncLoopDeps,
): CompassIdentitySyncLoop {
  const intervalMs = deps.intervalMs ?? COMPASS_IDENTITY_SYNC_INTERVAL_MS;
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await deps.sync();
    } catch (err) {
      warn(`[compass-identity] periodic sync threw: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext(): void {
    timer = setTimeout(() => {
      void tick().finally(scheduleNext);
    }, intervalMs);
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
