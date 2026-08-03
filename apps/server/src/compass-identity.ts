import type { McpServer, McpServerInput, Project } from '@veylin/shared';
import { projectSourceLabel } from '@veylin/shared';

/**
 * Syncs the single unified Compass account identity into the store — see
 * docs/superpowers/specs/2026-07-27-project-cognition-v3-design.md §B1.
 *
 * `VEYLIN_COMPASS_IDENTITY` carries one account-level `{url, token}` pair.
 * `GET {url}/my/sources` (Compass side, already deployed) returns the list of
 * data-source "scenes" that account is granted. Each reconcile pass keeps two
 * things in sync:
 *
 * 1. **Exactly ONE managed MCP entry** named `compass` (`COMPASS_ENTRY_NAME`)
 *    carrying only the account `Authorization` header — never
 *    `x-compass-source`. Scene binding is per-*connection*, composed by the
 *    compass client pool (Task 4) from the pinned project's source set; the
 *    entry itself is scene-less. Legacy per-scene entries
 *    (`compass-guolu`/`compass-shangzhong`/`compass-对比`) are no longer in
 *    the desired set, so `desiredVsCurrent`'s existing disable branch retires
 *    them automatically (disabled, never deleted).
 *
 * 2. **One managed default Project per granted source**
 *    (`desiredDefaultProjectsVsCurrent`): created on first grant (named via
 *    the shared source-label map), re-enabled on re-grant, disabled on
 *    revoke. User-composed (`managed: false`) projects are never touched.
 *
 * Mirrors mcp-retry-loop.ts's shape: pure decision functions
 * (`desiredVsCurrent`, `desiredDefaultProjectsVsCurrent`) that unit tests
 * drive directly, plus an orchestration function
 * (`reconcileCompassIdentity`) that takes its collaborators as `deps` so
 * tests can stub the network call and the store.
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

/** Managed name of THE single Compass MCP entry (v3 §B1). */
export const COMPASS_ENTRY_NAME = 'compass';

/**
 * Desired MCP server entries: exactly ONE, named `compass`, carrying only the
 * account `Authorization` header. Deliberately NO `x-compass-source` — scene
 * binding moved to per-connection headers composed by the compass client pool
 * from the pinned project's source set (v3 §B1), so the entry is scene-less.
 *
 * The grant list does not shape the entry (it shapes the default projects,
 * see `desiredDefaultProjectsVsCurrent`); it is accepted here only so the
 * reconciler's call site reads uniformly. Judgment call: the entry exists
 * whenever the identity is configured, even at zero granted sources — access
 * control lives at the project layer (no enabled project ⇒ every pin denies),
 * and the pool never opens a connection without a source set.
 */
export function desiredCompassEntries(
  config: CompassIdentityConfig,
  _sources: string[],
): DesiredCompassEntry[] {
  return [
    {
      name: COMPASS_ENTRY_NAME,
      transport: 'http' as const,
      url: `${config.url}/mcp/`,
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      enabled: true as const,
      group: COMPASS_IDENTITY_GROUP,
      managed: true as const,
    },
  ];
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
 *
 * v3 note: with desired = [`compass`], the legacy managed per-scene rows
 * (`compass-guolu`/`compass-shangzhong`/`compass-对比`) fall into the disable
 * branch above with no special casing — their names never equal `compass`, so
 * adopt-by-name cannot capture them.
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

export type DefaultProjectActions = {
  /** Granted source with no managed default project yet → create one. */
  createProjects: { name: string; source: string }[];
  /** Managed default project disabled earlier, source re-granted → re-enable. */
  enableProjects: { id: string; name: string }[];
  /** Managed default project whose source grant was revoked → disable. */
  disableProjects: { id: string; name: string }[];
};

/**
 * Pure diff: granted sources vs. the tenant's current project rows, producing
 * the default-project sync actions (v3 §B1: one managed default project per
 * granted source, `enabled` tracking the grant).
 *
 * - Only `managed: true` rows are ever considered — user-composed
 *   (`managed: false`) projects are invisible to this diff and NEVER touched,
 *   even when their sources overlap a granted or revoked source.
 * - A default project is identified by being managed with exactly one source.
 *   Managed rows with any other source count are an anomaly this fn leaves
 *   alone (the reconciler only ever creates single-source managed rows).
 * - Disabled-not-deleted: revoke → disable action; re-grant finds the
 *   disabled row again and re-enables it instead of creating a duplicate.
 */
export function desiredDefaultProjectsVsCurrent(
  sources: string[],
  currentProjects: Project[],
): DefaultProjectActions {
  const granted = Array.from(new Set(sources));
  const grantedSet = new Set(granted);

  const managedBySource = new Map<string, Project>();
  for (const project of currentProjects) {
    if (!project.managed) continue; // user-composed rows: never touched
    if (project.sources.length !== 1) continue; // not a default row: left alone
    const source = project.sources[0]!;
    if (!managedBySource.has(source)) managedBySource.set(source, project);
  }

  const actions: DefaultProjectActions = {
    createProjects: [],
    enableProjects: [],
    disableProjects: [],
  };

  for (const source of granted) {
    const existing = managedBySource.get(source);
    if (!existing) {
      actions.createProjects.push({ name: projectSourceLabel(source), source });
    } else if (!existing.enabled) {
      actions.enableProjects.push({ id: existing.id, name: existing.name });
    }
    // enabled + managed + granted → already in the desired state, no action.
  }

  for (const [source, project] of managedBySource) {
    if (grantedSet.has(source)) continue;
    if (!project.enabled) continue; // already disabled: no repeat action
    actions.disableProjects.push({ id: project.id, name: project.name });
  }

  return actions;
}

export type CompassIdentitySummary = {
  created: number;
  adopted: number;
  disabled: number;
  unchanged: number;
  projectsCreated: number;
  projectsEnabled: number;
  projectsDisabled: number;
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
  /** Project store (default-project sync) — server.ts binds project-store.ts. */
  listProjects: (tenantId: string) => Promise<Project[]>;
  createProject: (
    tenantId: string,
    input: { name: string; sources: string[]; managed?: boolean; enabled?: boolean },
  ) => Promise<Project>;
  updateProject: (
    tenantId: string,
    id: string,
    patch: { enabled?: boolean },
  ) => Promise<Project | null>;
  /**
   * Invalidates the tenant's pooled compass connections (compass-pool.ts)
   * whenever this pass changed anything (entry OR project), so no connection
   * outlives a token/grant change — server.ts binds the real
   * `invalidateCompassPool`. Optional so pure/stubbed tests can omit it.
   */
  invalidateCompassPool?: (tenantId: string) => void | Promise<void>;
  log?: (line: string) => void;
  warn?: (line: string) => void;
};

const emptySummary = (): CompassIdentitySummary => ({
  created: 0,
  adopted: 0,
  disabled: 0,
  unchanged: 0,
  projectsCreated: 0,
  projectsEnabled: 0,
  projectsDisabled: 0,
});

/**
 * Fetch /my/sources, diff against the store, and apply — both the single
 * `compass` entry AND the default projects in the same pass. Never destructive
 * on fetch failure — logs one line and leaves every existing entry and project
 * untouched. Triggers the same rebuild/reconnect path the manual reconnect
 * route uses whenever an *entry* actually changed (project rows don't feed the
 * generic MCP client, so project-only changes skip the rebuild); the pool
 * invalidation hook fires on ANY change.
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
  let entriesChanged = false;

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
        entriesChanged = true;
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
        entriesChanged = true;
        break;
      }
      case 'disable': {
        await deps.updateRemoteMcpServer(deps.tenantId, action.id, { enabled: false });
        summary.disabled += 1;
        entriesChanged = true;
        break;
      }
      case 'unchanged': {
        summary.unchanged += 1;
        break;
      }
    }
  }

  // Default-project sync — same pass, same grant list (v3 §B1).
  const currentProjects = await deps.listProjects(deps.tenantId);
  const projectActions = desiredDefaultProjectsVsCurrent(result.sources, currentProjects);
  for (const create of projectActions.createProjects) {
    await deps.createProject(deps.tenantId, {
      name: create.name,
      sources: [create.source],
      managed: true,
      enabled: true,
    });
    summary.projectsCreated += 1;
  }
  for (const enable of projectActions.enableProjects) {
    await deps.updateProject(deps.tenantId, enable.id, { enabled: true });
    summary.projectsEnabled += 1;
  }
  for (const disable of projectActions.disableProjects) {
    await deps.updateProject(deps.tenantId, disable.id, { enabled: false });
    summary.projectsDisabled += 1;
  }
  const projectsChanged =
    summary.projectsCreated > 0 || summary.projectsEnabled > 0 || summary.projectsDisabled > 0;

  if (entriesChanged) {
    await deps.rebuildMcp(deps.tenantId);
  }
  if (entriesChanged || projectsChanged) {
    // Drops every pooled compass connection for the tenant (compass-pool.ts) —
    // the pool reconnects lazily with fresh entry headers/grants on demand.
    await deps.invalidateCompassPool?.(deps.tenantId);
  }
  log(
    `[compass-identity] tenant=${deps.tenantId} created=${summary.created} adopted=${summary.adopted} ` +
      `disabled=${summary.disabled} unchanged=${summary.unchanged} ` +
      `projectsCreated=${summary.projectsCreated} projectsEnabled=${summary.projectsEnabled} ` +
      `projectsDisabled=${summary.projectsDisabled}`,
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
