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
import type { Project } from '@veylin/shared';

function rowToProject(row: NonNullable<Awaited<ReturnType<typeof getProjectRow>>>): Project {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    sources: row.sources,
    managed: row.managed,
    enabled: row.enabled,
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
}

export async function createProject(tenantId: string, input: ProjectInput): Promise<Project> {
  const row = await insertProjectRow(tenantId, {
    name: input.name.trim(),
    sources: input.sources,
    managed: input.managed ?? false,
    enabled: input.enabled ?? true,
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
