/**
 * Project CRUD routes (project-cognition v3) — the client surface over
 * project-store.ts.
 *
 * - `GET /api/projects` lists ENABLED projects only (the sidebar/pin-picker
 *   gate). Disabled rows — revoked defaults, user-deleted compositions — stay
 *   in the store for the reconciler/shim but are invisible to clients.
 * - `POST /api/projects` composes a user project (`managed: false`) from the
 *   granted sources. "Granted" = the sources of the ENABLED reconciler-managed
 *   default projects (`grantedSourcesSorted`) — the same definition the boot
 *   migration uses. `assertSourcesGranted` failures map to 400; this is the
 *   UX boundary, not the security boundary (Compass re-validates per call).
 * - `PATCH /api/projects/:id` renames/re-ticks USER-COMPOSED projects only.
 *   Managed rows are reconciler-owned → 403. Only `name`/`sources` are ever
 *   forwarded to the store, so `managed`/`enabled`/`migratedFrom` are
 *   structurally unpatchable from HTTP regardless of what the body carries.
 * - `DELETE /api/projects/:id` disables (never deletes) a user-composed
 *   project: pins to it start denying (deny-by-default, same as a revoked
 *   default) and history/provenance stay intact. Managed rows → 403.
 *
 * Wire shape is `{id, name, sources, managed}` — deliberately WITHOUT
 * `migratedFrom` (server-side structural identity for the provenance shim;
 * clients key display off `name` and behavior off `managed`, and exposing the
 * marker would invite keying client logic to it) and without `enabled`
 * (the list is enabled-only, so the field carries no information).
 *
 * Tenant scoping: every handler resolves the tenant via
 * `deps.resolveContext(req.headers)` like sibling routes; `getProject` is
 * tenant-checked, so foreign-tenant ids read as 404 (not-found posture,
 * consistent with routes/mcp.ts).
 */
import type { FastifyInstance } from 'fastify';
import type { Project } from '@veylin/shared';
import { invalidateCompassPool } from '../compass-pool.js';
import { grantedSourcesSorted } from '../project-migration.js';
import {
  assertSourcesGranted,
  createProject,
  disableProject,
  getProject,
  listProjects,
  updateProject,
} from '../project-store.js';
import type { ServerDeps } from './types.js';
import { isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';

type ApiProject = Pick<Project, 'id' | 'name' | 'sources' | 'managed' | 'folder'>;

function toApiProject(project: Project): ApiProject {
  return {
    id: project.id,
    name: project.name,
    sources: project.sources,
    managed: project.managed,
    // 项目文件夹要能被界面看到 —— 否则"绑没绑"这件事只有服务端知道。
    ...(project.folder ? { folder: project.folder } : {}),
  };
}

/**
 * Validate a client-supplied sources value: must be an array of non-empty
 * strings. Returns the canonical form — de-duped and sorted, matching the
 * migration's composed-project convention and `sceneSetKey`'s semantics — or
 * null when malformed. `[]` is well-formed here; `assertSourcesGranted`
 * rejects emptiness with its own message.
 */
function parseSources(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((s): s is string => typeof s === 'string' && s.trim() !== '')) return null;
  return Array.from(new Set(raw)).sort();
}

export function registerProjectsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/projects', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const projects = await listProjects(ctx.tenantId);
    return { projects: projects.filter((p) => p.enabled).map(toApiProject) };
  });

  app.post('/api/projects', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { name?: unknown; sources?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') {
      reply.code(400);
      return { ok: false, error: 'name is required' };
    }
    const sources = parseSources(body.sources ?? []);
    if (!sources) {
      reply.code(400);
      return { ok: false, error: 'sources must be an array of source codes' };
    }
    const granted = grantedSourcesSorted(await listProjects(ctx.tenantId));
    try {
      assertSourcesGranted(sources, granted);
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const project = await createProject(ctx.tenantId, { name, sources });
    return { ok: true, project: toApiProject(project) };
  });

  app.patch('/api/projects/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const existing = await getProject(ctx.tenantId, id);
    // Disabled = deleted from the client's perspective (list never shows it),
    // so a PATCH against it gets the same not-found posture as a foreign id.
    if (!existing || !existing.enabled) {
      reply.code(404);
      return { ok: false, error: 'project not found' };
    }
    const body = (req.body ?? {}) as { name?: unknown; sources?: unknown; folder?: unknown };
    const patch: { name?: string; sources?: string[]; folder?: string } = {};

    // 项目文件夹既不是身份也不是范围,是**本机偏好** —— 所以 managed 项目
    // (guolu、上重这些默认项目,恰恰是用户真正在用的)也能设。名字与场景仍归
    // reconciler 管。见 docs/specs/2026-08-14-project-folder-immutable-originals.md。
    if (body.folder !== undefined) {
      const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
      if (!folder || !isAbsolute(folder)) {
        reply.code(400);
        return { ok: false, error: 'folder 必须是绝对路径' };
      }
      let isDir = false;
      try {
        isDir = (await stat(folder)).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        // 早失败:绑一个不存在的目录,用户会以为绑好了,而原件一份也不会落下来。
        reply.code(400);
        return { ok: false, error: `folder 不存在或不是目录: ${folder}` };
      }
      patch.folder = folder;
    }

    if (existing.managed && (body.name !== undefined || body.sources !== undefined)) {
      reply.code(403);
      return { ok: false, error: 'managed projects cannot be modified' };
    }
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name === '') {
        reply.code(400);
        return { ok: false, error: 'name must be non-empty' };
      }
      patch.name = name;
    }
    if (body.sources !== undefined) {
      const sources = parseSources(body.sources);
      if (!sources) {
        reply.code(400);
        return { ok: false, error: 'sources must be an array of source codes' };
      }
      const granted = grantedSourcesSorted(await listProjects(ctx.tenantId));
      try {
        assertSourcesGranted(sources, granted);
      } catch (err) {
        reply.code(400);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      patch.sources = sources;
    }
    if (patch.name === undefined && patch.sources === undefined && patch.folder === undefined) {
      reply.code(400);
      return { ok: false, error: 'name / sources / folder 至少给一个' };
    }

    // Only name/sources/folder ever reach the store from here — managed/enabled/
    // migratedFrom stay structurally out of HTTP reach.
    const updated = await updateProject(ctx.tenantId, id, patch);
    if (!updated) {
      reply.code(404);
      return { ok: false, error: 'project not found' };
    }
    if (patch.sources !== undefined) {
      // The old scene-set's pooled connection is now unreferenced by this
      // project — drop it so sessions/fds don't linger until the next
      // reconciler tick (scope is re-resolved per request either way; this
      // is retention hygiene, not a correctness need).
      await invalidateCompassPool(ctx.tenantId);
    }
    return { ok: true, project: toApiProject(updated) };
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { id } = req.params as { id: string };
    const existing = await getProject(ctx.tenantId, id);
    if (!existing) {
      reply.code(404);
      return { ok: false, error: 'project not found' };
    }
    if (existing.managed) {
      reply.code(403);
      return { ok: false, error: 'managed projects cannot be deleted' };
    }
    // Disable, never delete: pins to this project start denying (the exact
    // revoked-default posture) and no pin cleanup runs — re-pinning is a user
    // action. Idempotent on an already-disabled row.
    await disableProject(ctx.tenantId, id);
    await invalidateCompassPool(ctx.tenantId);
    return { ok: true };
  });
}
