/**
 * Project store — CRUD wrappers over the `project` table (mirrors mcp-store.ts
 * over `mcp_server`). A Project is the first-class thread-pin target (v3): a
 * named set of granted Compass sources. Reconciler-managed default rows are
 * `managed: true`; user-composed rows are `managed: false`. Projects are
 * disabled, never deleted — a pin to a disabled project denies scoped access.
 */
import {
  disableProjectRow,
  getProjectRow,
  insertProjectRow,
  listProjectRows,
  updateProjectRow,
} from '@veylin/db';
import type { McpServer, Project } from '@veylin/shared';
import { COMPASS_IDENTITY_GROUP } from './compass-identity.js';
import { listRemoteMcpServers } from './mcp-store.js';

function rowToProject(row: NonNullable<Awaited<ReturnType<typeof getProjectRow>>>): Project {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    sources: row.sources,
    managed: row.managed,
    enabled: row.enabled,
    migratedFrom: row.migratedFrom,
    createdAt: row.createdAt,
  };
}

/** All projects for a tenant, disabled included (the reconciler re-enables on re-grant). */
export async function listProjects(tenantId: string): Promise<Project[]> {
  const rows = await listProjectRows(tenantId);
  return rows.map(rowToProject);
}

/** Tenant-checked single lookup: null for missing OR foreign-tenant ids (deny-by-default). */
export async function getProject(tenantId: string, id: string): Promise<Project | null> {
  const row = await getProjectRow(tenantId, id);
  return row ? rowToProject(row) : null;
}

export interface ProjectInput {
  name: string;
  sources: string[];
  managed?: boolean;
  enabled?: boolean;
  /** Set-once identity marker; only the boot migration passes this. Not patchable. */
  migratedFrom?: string;
}

export async function createProject(tenantId: string, input: ProjectInput): Promise<Project> {
  const row = await insertProjectRow(tenantId, {
    name: input.name.trim(),
    sources: input.sources,
    managed: input.managed ?? false,
    enabled: input.enabled ?? true,
    migratedFrom: input.migratedFrom,
  });
  return rowToProject(row);
}

export async function updateProject(
  tenantId: string,
  id: string,
  patch: Partial<ProjectInput>,
): Promise<Project | null> {
  const row = await updateProjectRow(tenantId, id, {
    ...(patch.name != null ? { name: patch.name.trim() } : {}),
    ...(patch.sources != null ? { sources: patch.sources } : {}),
    ...(patch.managed != null ? { managed: patch.managed } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
  });
  return row ? rowToProject(row) : null;
}

/** Disabled-not-deleted: pins to a disabled project deny, history stays. */
export async function disableProject(tenantId: string, id: string): Promise<Project | null> {
  const row = await disableProjectRow(tenantId, id);
  return row ? rowToProject(row) : null;
}

/**
 * Result of the shared scoping prelude (`resolvePinnedProjectScope`).
 *
 * `entryPin` is what the review-hardened pure scoping functions
 * (mcp-scoping.ts) consume in place of the raw thread pin; `sources` is what
 * the compass pool (compass-pool.ts) binds the connection to; `entry` is the
 * enabled compass MCP row the pool connects with. All-null (`deniedScope`)
 * means: no grouped MCP access this request, deny-by-default.
 */
export type PinnedProjectScope = {
  /** The resolved, enabled, tenant-owned project — null when the pin denies. */
  project: Project | null;
  /**
   * Entry-level pin for the pure scoping fns: the enabled
   * `COMPASS_IDENTITY_GROUP` member's name ('compass'), or null (deny).
   */
  entryPin: string | null;
  /** The pinned project's scene set — becomes the pooled connection's key AND `x-compass-source` header (sceneSetKey). */
  sources: string[];
  /** The enabled compass entry row backing `entryPin` (the pool's connect target); null iff `entryPin` is null. */
  entry: McpServer | null;
};

function deniedScope(): PinnedProjectScope {
  return { project: null, entryPin: null, sources: [], entry: null };
}

/**
 * The shared scoping prelude (project-cognition v3): translate a thread's
 * PROJECT pin (a project id) into the entry-level pin that the pure scoping
 * functions (`resolveScopedMcp` / `filterMcpToolIndexToScopedServers` /
 * `scopeServersToAllowlist`) operate on — ONCE per request, so those
 * functions and their isolation guarantees survive unchanged.
 *
 * Deny-by-default: an unpinned thread and a missing, foreign-tenant, or
 * disabled project pin all resolve to the all-null shape — the same posture
 * as the pre-v3 stale-entry-pin path: grouped MCP servers simply never
 * surface for the request.
 *
 * `entryPin` requires EXACTLY ONE enabled `COMPASS_IDENTITY_GROUP` member
 * (the reconciler maintains exactly one, named 'compass'; legacy per-scene
 * rows are disabled). Zero enabled members — or more than one, an anomaly —
 * leaves `entryPin`/`entry` null: refusal over guessing which entry the
 * scene set would bind to (mirrors `resolveCompassServer`'s
 * refusal-over-guess posture). The resolved `project` is still returned in
 * that case so display surfaces (e.g. the chat pin reminder) can name it.
 */
export async function resolvePinnedProjectScope(
  tenantId: string,
  pin: string | null,
): Promise<PinnedProjectScope> {
  if (pin == null || pin === '') return deniedScope();
  const project = await getProject(tenantId, pin);
  if (!project || !project.enabled) return deniedScope();
  const enabledCompassEntries = (await listRemoteMcpServers(tenantId)).filter(
    (server) => server.group === COMPASS_IDENTITY_GROUP && server.enabled,
  );
  if (enabledCompassEntries.length !== 1) {
    return { project, entryPin: null, sources: project.sources, entry: null };
  }
  const entry = enabledCompassEntries[0]!;
  return { project, entryPin: entry.name, sources: project.sources, entry };
}

/**
 * Guard for compose/pin time: a project's sources must be a non-empty subset
 * of the tenant's granted Compass sources. Throws otherwise — callers map the
 * error to a 400/deny. (Compass re-validates per call regardless; this is the
 * server-side UX boundary, not the security boundary.)
 */
export function assertSourcesGranted(sources: string[], granted: string[]): void {
  if (sources.length === 0) {
    throw new Error('project must include at least one source');
  }
  const grantedSet = new Set(granted);
  const ungranted = sources.filter((s) => !grantedSet.has(s));
  if (ungranted.length > 0) {
    throw new Error(`sources not granted to this tenant: ${ungranted.join(', ')}`);
  }
}
