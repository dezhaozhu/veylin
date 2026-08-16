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
    folder: row.folder,
    instructions: row.instructions,
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
  /** 项目文件夹绝对路径(用户选)。见 spec 2026-08-14。 */
  folder?: string;
  /** 项目级指令 —— 会进系统块,影响这个项目里所有对话。 */
  instructions?: string;
}

export async function createProject(tenantId: string, input: ProjectInput): Promise<Project> {
  const row = await insertProjectRow(tenantId, {
    name: input.name.trim(),
    sources: input.sources,
    managed: input.managed ?? false,
    enabled: input.enabled ?? true,
    migratedFrom: input.migratedFrom,
    ...(input.folder != null ? { folder: input.folder } : {}),
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
    ...(patch.folder != null ? { folder: patch.folder } : {}),
    // 空串是「有意清空」,不是「没传」—— 所以判 != null 而不是真值。
    ...(patch.instructions != null ? { instructions: patch.instructions } : {}),
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
 * 项目的数据源必须是本租户已授权集合的**子集**。不是子集就抛,调用方映射成 400。
 * (Compass 每次调用都会再验一遍;这里是服务端的 UX 边界,不是安全边界。)
 *
 * **空集合法**:一个零数据源的项目 = 只用你自己的文件和文件夹。原来强制至少选
 * 一个,等于把"项目"降成"数据源的别名" —— 而每个数据源本来就已经有一个默认项目;
 * 人自己建项目是为了"我要做的事",不是"我要看哪个厂"。而且建项目的那一刻,常常
 * 还不知道要用哪个数据源。
 */
export function assertSourcesGranted(sources: string[], granted: string[]): void {
  const grantedSet = new Set(granted);
  const ungranted = sources.filter((s) => !grantedSet.has(s));
  if (ungranted.length > 0) {
    throw new Error(`sources not granted to this tenant: ${ungranted.join(', ')}`);
  }
}
