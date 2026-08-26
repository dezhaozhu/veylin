import { readProjectFile, renderProjectFilePage } from '../project-file-read.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  getTableSheetMeta,
  isProjectPinMismatch,
  importTableSheet,
  isTableSheetNameTaken,
  listTableColumns,
  listTableRows,
  listTableRowsPage,
  listTableSheets,
  countTableRows,
  MAX_TABLE_HTTP_PAGE,
  renameTableSheet,
  tryResolveTableSheetId,
  sheetBelongsToScope,
  flushTablePersist,
  stampTableSheetSource,
  updateTableRows,
  DEFAULT_TABLE_SHEET,
  onTableEvent,
  type TableRowPatch,
  type TableEvent,
  getTableRow,
} from '../table-store.js';
import { recordTableEdits } from '../table-edit-journal.js';
import { formatSelectionToken, registerSelection } from '../table-selection.js';
import type { ServerDeps } from './types.js';
import {
  unwrapMcpPayload,
  importCompassScheduleSheet,
  type CompassLoadScope,
} from '../table-tools.js';
import { resolveCompassServer } from '../mcp-scoping.js';
import { resolveThreadPin } from '../thread-state.js';
import { resolveSheetScope } from '../table-tools.js';
import type { SheetScope } from '../table-scope.js';
import { eventVisibleInScope } from '../table-event-scope.js';
import { archiveImportedFile } from '../table-import-archive.js';
import { writeSheetSnapshot } from '../project-snapshot.js';
import { scanProjectInbox } from '../project-inbox.js';
import { revealInFileManager } from '../project-reveal.js';
import { listProjectFiles, summarizeConnectors } from '../project-context.js';
import { writeDecisionRecord } from '../decision-record.js';
import { getProject } from '../project-store.js';
import { isFileSource } from '@veylin/db';
import { listProjects } from '../project-store.js';
import { resolvePinnedProjectScope } from '../project-store.js';
import { getPooledCompassToolsets, sceneSetKey, type CompassPoolDeps } from '../compass-pool.js';
import { compassRestBase, fetchCompassData, type CompassRestScope } from '../compass-rest.js';
import {
  proposeScheduleEdit,
  previewScheduleEdit,
  commitScheduleEdit,
  discardScheduleEdits,
  type ProposeEditBody,
} from '../schedule-edit.js';

// Fork seam: threadId is OPTIONAL on these routes. It is what the request's
// **作用域**(表的归属)is resolved from —— thread → 项目钉定 → scope。没带
// threadId(或那个会话没钉项目)= 个人区。
function requireThreadId(
  _reply: FastifyReply,
  threadId: string | undefined | null,
): string | null {
  return threadId?.trim() || null;
}

/**
 * 这个请求在哪个作用域。规则与 agent 侧同一处实现(`resolveSheetScope`):
 * 有项目钉定 → 项目;没有 → 个人区。见 spec §3.3。
 */
async function scopeOfRequest(
  threadId: string | undefined | null,
  ctx: { tenantId: string; resourceOwnerId: string },
): Promise<SheetScope> {
  const pin = await resolveThreadPin(threadId ?? undefined, ctx);
  return resolveSheetScope(threadId, pin);
}

/**
 * Read `threadId` off a request — body first, then query — for the
 * Compass-backed routes below that resolve their pin from it. GETs
 * (schedule-detail) only ever carry it as a query param; POSTs (schedule-edit
 * propose/preview/commit/discard, load-compass-schedule) accept it in the
 * JSON body (what the web client sends) or the query string, mirroring how
 * POST /api/mcp-apps/host reads it in routes/mcp-apps.ts.
 */
function threadIdFromRequest(req: {
  body?: unknown;
  query?: unknown;
}): string | undefined {
  const body = req.body as { threadId?: string } | undefined;
  const query = req.query as { threadId?: string } | undefined;
  return body?.threadId ?? query?.threadId;
}

/**
 * Per-request Compass scope for this file's Compass-backed routes
 * (schedule-detail, the governed schedule-edit routes, load-compass-schedule)
 * — project-cognition v3, Phase B 5c.
 *
 * `threadId → resolveThreadPin` (ownership-checked; the pin is a PROJECT id
 * post-migration) `→ resolvePinnedProjectScope` (the shared prelude)
 * `→ getPooledCompassToolsets` for the pinned project's scene set:
 *
 * - Pin resolves to an enabled project + compass entry → `getToolsets`
 *   returns the POOLED record `{ [entryPin]: tools }` — the connection whose
 *   `x-compass-source` header is exactly the project's scene set. The tenant
 *   cache is never consulted (plan risk #2: post-Task-4 it cannot contain
 *   compass; a pooled miss must mean "no compass", never a differently-scoped
 *   substitute).
 * - Pool failure → `getToolsets` returns `{}`: the honest "compass MCP not
 *   connected" refusal every caller already has, never a fallback connection.
 * - No/denied pin (missing, foreign, disabled, or unowned/foreign threadId —
 *   `resolveThreadPin`'s ownership check) → tenant-toolsets fallback with a
 *   null pin, today's pre-v3 no-thread-context path: post-cutover the tenant
 *   cache has no compass (refusal); a legacy ungrouped manual `compass` entry
 *   keeps resolving via `resolveCompassServer` rules 2/3.
 *
 * `projectId` is the provenance value stamped as `source.project` on sheets
 * loaded through these routes (plan risk #1: the PROJECT id, never the
 * resolved toolset key).
 *
 * `rest` is the REST data-plane scope (spec 2026-08-06 三形态 §2 ①) for the
 * SAME pin: `baseUrl` from the entry's `/mcp/` url, headers carrying the
 * entry's Authorization plus `x-compass-source` composed by `sceneSetKey` —
 * the identical scene-set identity the pooled MCP connection above uses.
 * `null` whenever the pin denies (no entry to bind a REST call to).
 *
 * Exported (with injectable seams, compass-pool deps style) as the testable
 * seam — no HTTP harness exists in this repo (see tables-thread-pin.test.ts).
 */
export type CompassRequestScope = {
  getToolsets: () => Record<string, unknown>;
  entryPin: string | null;
  projectId: string | null;
  rest: CompassRestScope | null;
  /** Scope for importCompassScheduleSheet; undefined = tenant-getter fallback (no pin). */
  loadScope: CompassLoadScope | undefined;
};

export async function resolveCompassRequestScope(
  threadId: string | undefined,
  ctx: { tenantId: string; resourceOwnerId: string },
  deps: { getMcpToolsets: () => Record<string, unknown> },
  seams: {
    resolveScope?: typeof resolvePinnedProjectScope;
    getPooledToolsets?: typeof getPooledCompassToolsets;
    poolDeps?: CompassPoolDeps;
  } = {},
): Promise<CompassRequestScope> {
  const pin = await resolveThreadPin(threadId, ctx);
  const scope = await (seams.resolveScope ?? resolvePinnedProjectScope)(ctx.tenantId, pin);
  if (scope.entryPin == null || scope.entry == null || scope.project == null) {
    return {
      getToolsets: deps.getMcpToolsets,
      entryPin: null,
      projectId: null,
      rest: null,
      loadScope: undefined,
    };
  }
  const pooled = await (seams.getPooledToolsets ?? getPooledCompassToolsets)(
    ctx.tenantId,
    scope.entry,
    scope.sources,
    seams.poolDeps ?? {},
  );
  const record: Record<string, unknown> =
    pooled == null ? {} : { [scope.entryPin]: pooled[scope.entryPin] ?? {} };
  const rest: CompassRestScope = {
    baseUrl: compassRestBase(scope.entry.url),
    headers: { ...scope.entry.headers, 'x-compass-source': sceneSetKey(scope.sources) },
  };
  return {
    getToolsets: () => record,
    entryPin: scope.entryPin,
    projectId: scope.project.id,
    rest,
    loadScope: {
      toolsets: record,
      entryPin: scope.entryPin,
      projectId: scope.project.id,
      rest,
    },
  };
}

type SheetAccess = { sheetId: string; scope: SheetScope };

/**
 * 解析表并核对归属:不属于本作用域的表,一律 404 —— 不是"看得见但没权限"。
 *
 * **显式给了 id 就绝不退回默认表**。退回是这里最危险的行为:一个请求带着项目里的
 * sheet id、却没带 threadId(于是解析成个人区),退回默认表就把行**写进了个人区的
 * main** —— 返回 200、写错地方,比 404 糟得多。`tryResolveTableSheetId` 正是这个
 * 语义:给了但找不到/不属于本作用域 → null;没给 → 本作用域的默认表。
 */
function requireScopedSheet(
  reply: FastifyReply,
  sheetParam: string | undefined,
  scope: SheetScope,
): SheetAccess | { error: { ok: false; message: string } } {
  const sheetId = tryResolveTableSheetId(sheetParam, scope);
  if (!sheetId || !sheetBelongsToScope(sheetId, scope)) {
    reply.code(404);
    return { error: { ok: false, message: 'sheet not found' } };
  }
  return { sheetId, scope };
}

function isSheetAccess(
  value: SheetAccess | { error: { ok: false; message: string } },
): value is SheetAccess {
  return 'sheetId' in value;
}

export function registerTablesRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // Editable multi-sheet table dataset for the right-panel data grid.
  app.get('/api/table', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { sheet, threadId, offset, limit } = req.query as {
      sheet?: string;
      threadId?: string;
      offset?: string;
      limit?: string;
    };
    const scope = await scopeOfRequest(threadId, ctx);
    const access = requireScopedSheet(reply, sheet, scope);
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const parsedLimit = limit != null && limit !== '' ? Number(limit) : undefined;
    const parsedOffset = offset != null && offset !== '' ? Number(offset) : 0;
    const page =
      parsedLimit != null && Number.isFinite(parsedLimit)
        ? listTableRowsPage(
            access.sheetId,
            Number.isFinite(parsedOffset) ? parsedOffset : 0,
            parsedLimit,
            MAX_TABLE_HTTP_PAGE,
          )
        : null;
    return {
      sheet: access.sheetId,
      sheets: listTableSheets(scope),
      defaultSheet: DEFAULT_TABLE_SHEET,
      columns: listTableColumns(access.sheetId),
      rows: page ? page.rows : listTableRows(access.sheetId),
      totalRows: page ? page.totalRows : countTableRows(access.sheetId),
    };
  });

  // Server-Sent Events: push row-level table changes so the client can drop its 4s
  // full-sheet poll and apply surgical AG-Grid transactions (cost independent of size).
  app.get('/api/table/stream', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    // 推送也按作用域:不在作用域里的表变了,这个连接不该知道(spec §7)。
    const scope = await scopeOfRequest(threadId, ctx);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('retry: 3000\n\n');
    const send = (event: TableEvent): void => {
      if (!eventVisibleInScope(event, scope)) return;
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = onTableEvent(send);
    const keepAlive = setInterval(() => raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // 二三级 master-detail drill-down: given a 二级 schedule row (order_id + stage_code),
  // proxy to the Compass `get_workorder_rows` MCP tool for that row's 三级 ops.
  // Read-only; used by the table's AG-Grid detail grid (Pro feature).
  app.get('/api/schedule-detail', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { order_id, wbs, stage_code, material, limit, threadId } = req.query as {
      order_id?: string;
      wbs?: string;
      stage_code?: string;
      material?: string;
      limit?: string;
      threadId?: string;
    };
    // Resolve the scope from the CURRENTLY OPEN thread (query param — mirrors
    // GET /api/mcp-apps/tools in routes/mcp-apps.ts): threadId → project pin
    // → pooled scene-set toolsets (see resolveCompassRequestScope above). A
    // missing/foreign threadId falls back to the tenant toolsets with a null
    // pin — resolveCompassServer then refuses rather than guessing.
    const scope = await resolveCompassRequestScope(threadId, ctx, deps);
    if (scope.rest) {
      const r = await fetchCompassData(scope.rest, '/data/workorder-rows', {
        order_id,
        wbs,
        stage_code,
        material,
        limit: limit ? Math.max(1, parseInt(limit, 10)) : 500,
      });
      if (r.ok) {
        return {
          ok: true,
          columns: r.payload['columns'] ?? [],
          rows: r.payload['rows'] ?? [],
          total: r.payload['total'] ?? 0,
        };
      }
      console.warn('[tables] schedule-detail data-plane fetch failed, falling back to MCP:', r.error);
    }
    const scopedToolsets = scope.getToolsets();
    const serverName = resolveCompassServer(scopedToolsets, deps.getMcpGroups(), scope.entryPin);
    const compass = serverName
      ? (scopedToolsets[serverName] as
          | Record<string, { execute: (args: unknown) => Promise<unknown> }>
          | undefined)
      : undefined;
    const tool = compass?.['get_workorder_rows'];
    if (!tool) {
      reply.code(503);
      return { ok: false, error: 'compass MCP not connected (no get_workorder_rows)', columns: [], rows: [], total: 0 };
    }
    const res = await tool.execute({
      order_id,
      wbs,
      stage_code,
      material,
      limit: limit ? Math.max(1, parseInt(limit, 10)) : 500,
    });
    const payload = unwrapMcpPayload(res);
    return {
      ok: true,
      columns: payload['columns'] ?? [],
      rows: payload['rows'] ?? [],
      total: payload['total'] ?? 0,
    };
  });

  // ------------------------------------------------------------------
  // B2 governed schedule editing: grid cell edits & panel actions go through
  // Compass's draft lane (propose → preview → commit/discard). The draft lives
  // in Compass keyed by the server's OBO principal — never a silent live write.
  //
  // Each route below resolves its scope from the CURRENTLY OPEN thread (body
  // or query threadId — the web client sends it in the JSON body since these
  // are POSTs; query is accepted too, mirroring POST /api/mcp-apps/host) via
  // resolveCompassRequestScope: threadId → project pin (ownership-checked) →
  // pooled scene-set toolsets. A missing/foreign threadId keeps the same "no
  // thread context" fallback these routes had before threading landed.
  // deps.getMcpGroups() is still passed through so resolveCompassServer can
  // refuse (rather than silently guess 'compass') under any ambiguity — an
  // honest "not connected" beats a governed WRITE landing on the wrong
  // project's Compass connection.
  // ------------------------------------------------------------------
  app.post('/api/schedule-edit/propose', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    // Strip threadId before forwarding to Compass's propose_schedule_edit tool —
    // it's routing metadata for the pin resolution below, not an edit field.
    const { threadId: _threadId, ...body } = (req.body ?? {}) as ProposeEditBody & {
      threadId?: string;
    };
    const scope = await resolveCompassRequestScope(threadIdFromRequest(req), ctx, deps);
    const out = await proposeScheduleEdit(scope.getToolsets, body, deps.getMcpGroups(), scope.entryPin);
    if (!out.ok) reply.code('refused' in out && out.refused ? 403 : 503);
    return out;
  });

  app.post('/api/schedule-edit/preview', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const scope = await resolveCompassRequestScope(threadIdFromRequest(req), ctx, deps);
    const out = await previewScheduleEdit(scope.getToolsets, deps.getMcpGroups(), scope.entryPin);
    if (!out.ok) reply.code(503);
    return out;
  });

  app.post('/api/schedule-edit/commit', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const scope = await resolveCompassRequestScope(threadIdFromRequest(req), ctx, deps);
    const out = await commitScheduleEdit(scope.getToolsets, deps.getMcpGroups(), scope.entryPin);
    if (!out.ok) {
      reply.code('conflict' in out && out.conflict ? 409 : 503);
      return out;
    }
    // 提交这一刻,那份预览就**当过依据**了 —— 自动留档(spec §5.1 第三档)。
    // 不靠人记得点保存:它是这个决定的凭据,将来要能翻账。
    // 留档失败绝不能翻成错误响应:提交已经发生了。
    const record = await writeDecisionRecord({
      folder: scope.projectId
        ? (await getProject(ctx.tenantId, scope.projectId))?.folder
        : undefined,
      title: '排产变更',
      summary: `提交 ${out.committed} 条改动` + (out.deferred ? `,延后 ${out.deferred} 条` : ''),
      facts: {
        提交条数: out.committed,
        延后条数: out.deferred,
        结果: out.status,
        未排: out.unscheduled,
        run_id: String(out.run_id ?? '—'),
        提案: (out.proposal_ids ?? []).join('、') || '—',
      },
    }).catch((e: unknown) => ({ written: false as const, reason: String(e) }));

    // Refresh the schedule sheet from Compass so the grid shows the new run
    // (importTableSheet emits sheetReplace → SSE → client refetch).
    // Best-effort: the commit already happened — never turn a refresh failure into an error response.
    try {
      await importCompassScheduleSheet(deps.getMcpToolsets, {}, deps.getMcpGroups, scope.loadScope);
    } catch {
      /* best-effort refresh; grid converges on next manual load */
    }
    return {
      ...out,
      recorded: record.written,
      ...(record.written ? { recordPath: record.path } : {}),
      ...(record.reason ? { recordNote: record.reason } : {}),
    };
  });

  app.post('/api/schedule-edit/discard', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const scope = await resolveCompassRequestScope(threadIdFromRequest(req), ctx, deps);
    const out = await discardScheduleEdits(scope.getToolsets, deps.getMcpGroups(), scope.entryPin);
    if (!out.ok) {
      reply.code(503);
      return out;
    }
    // Re-import to revert the grid's optimistic cell echoes back to canonical.
    // Best-effort: the discard already happened — never turn a refresh failure into an error response.
    try {
      await importCompassScheduleSheet(deps.getMcpToolsets, {}, deps.getMcpGroups, scope.loadScope);
    } catch {
      /* best-effort refresh; grid converges on next manual load */
    }
    return out;
  });

  app.post('/api/table/load-compass-schedule', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    await deps.ensureMcpForTenant(ctx.tenantId);
    const body = (req.body ?? {}) as {
      limit?: number;
      workshop?: string;
      status?: string;
      order_id?: string;
      threadId?: string;
    };
    const scope = await resolveCompassRequestScope(threadIdFromRequest(req), ctx, deps);
    const result = await importCompassScheduleSheet(
      deps.getMcpToolsets,
      body,
      deps.getMcpGroups,
      scope.loadScope,
    );
    if (!result.ok) {
      reply.code(result.error.includes('not connected') ? 503 : 400);
      return result;
    }
    return result;
  });

  // Lightweight sheet-tab list (no row payload) — used after sheetsChange SSE.
  app.get('/api/table/sheets', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    return { ok: true, sheets: listTableSheets(await scopeOfRequest(threadId, ctx)) };
  });

  app.post('/api/table/sheets', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { name, threadId } = (req.body ?? {}) as { name?: string; threadId?: string };
    const trimmed = name?.trim();
    // 面板上新建的表落在**当前作用域**(项目 or 个人区),不再是对话级 —— 在
    // 面板上建一张表是工作区行为,不是"这一轮的临时物"(spec §3.4)。
    const scoped = await scopeOfRequest(threadId, ctx);
    if (!trimmed) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    if (isTableSheetNameTaken(trimmed, undefined, scoped)) {
      reply.code(409);
      return {
        ok: false,
        message: `Sheet name "${trimmed}" already exists. Sheet names must be unique.`,
      };
    }
    const sheet = createTableSheet(trimmed, scoped);
    if (!sheet) {
      reply.code(400);
      return { ok: false, message: 'Failed to create sheet' };
    }
    return { ok: true, sheet, sheets: listTableSheets(scoped) };
  });

  app.delete('/api/table/sheets/:sheetId', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { sheetId } = req.params as { sheetId: string };
    const { threadId } = req.query as { threadId?: string };
    const scoped = await scopeOfRequest(threadId, ctx);
    const existing = getTableSheetMeta(sheetId);
    if (!existing || !sheetBelongsToScope(sheetId, scoped)) {
      reply.code(404);
      return { ok: false, message: 'sheet not found' };
    }
    const ok = await deleteTableSheet(sheetId);
    if (!ok) {
      reply.code(400);
      return { ok: false, message: 'Failed to delete sheet' };
    }
    const sheets = listTableSheets(scoped);
    const nextSheet = sheets[0]?.id ?? DEFAULT_TABLE_SHEET;
    return { ok: true, sheets, nextSheet };
  });

  app.patch('/api/table/sheets/:sheetId', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { sheetId } = req.params as { sheetId: string };
    const { name, threadId } = (req.body ?? {}) as { name?: string; threadId?: string };
    const trimmed = name?.trim();
    if (!trimmed) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const scoped = await scopeOfRequest(threadId, ctx);
    const existing = getTableSheetMeta(sheetId);
    if (!existing || !sheetBelongsToScope(sheetId, scoped)) {
      reply.code(404);
      return { ok: false, message: 'sheet not found' };
    }
    if (isTableSheetNameTaken(trimmed, sheetId, scoped)) {
      reply.code(409);
      return {
        ok: false,
        message: `Sheet name "${trimmed}" already exists. Sheet names must be unique.`,
      };
    }
    const sheet = renameTableSheet(sheetId, trimmed);
    if (!sheet) {
      reply.code(400);
      return { ok: false, message: 'Failed to rename sheet' };
    }
    return { ok: true, sheet, sheets: listTableSheets(scoped) };
  });

  app.post('/api/table/rows', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { sheet, threadId } = (req.body ?? {}) as { sheet?: string; threadId?: string };
    const access = requireScopedSheet(reply, sheet, await scopeOfRequest(threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const row = addTableRow(access.sheetId);
    if (!row) {
      reply.code(400);
      return { ok: false, message: 'Failed to add row' };
    }
    return { ok: true, sheet: access.sheetId, row, rows: listTableRows(access.sheetId) };
  });

  app.delete('/api/table/rows', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      threadId?: string;
      row_keys?: string[];
      order_nos?: string[];
    };
    const access = requireScopedSheet(reply, body.sheet, await scopeOfRequest(body.threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const rowKeys = body.row_keys ?? body.order_nos ?? [];
    const { removed } = deleteTableRows(access.sheetId, rowKeys);
    return { ok: true, sheet: access.sheetId, removed, rows: listTableRows(access.sheetId) };
  });

  app.post('/api/table/columns', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { sheet, name, threadId } = (req.body ?? {}) as {
      sheet?: string;
      name?: string;
      threadId?: string;
    };
    const access = requireScopedSheet(reply, sheet, await scopeOfRequest(threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    if (!name?.trim()) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const column = addTableColumn(access.sheetId, name);
    if (!column) {
      reply.code(400);
      return { ok: false, message: 'Failed to add column' };
    }
    return {
      ok: true,
      sheet: access.sheetId,
      column,
      columns: listTableColumns(access.sheetId),
    };
  });

  app.delete('/api/table/columns', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { sheet, key, threadId } = (req.body ?? {}) as {
      sheet?: string;
      key?: string;
      threadId?: string;
    };
    const access = requireScopedSheet(reply, sheet, await scopeOfRequest(threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    if (!key || !deleteTableColumn(access.sheetId, key)) {
      reply.code(400);
      return { ok: false, message: 'Failed to delete column' };
    }
    return {
      ok: true,
      sheet: access.sheetId,
      columns: listTableColumns(access.sheetId),
      rows: listTableRows(access.sheetId),
    };
  });

  app.patch('/api/table/rows', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      threadId?: string;
      rows?: Array<
        {
          row_key?: string;
          row_id?: string;
          order_no?: string;
        } & TableRowPatch
      >;
    };
    const { sheet, threadId, rows: rawRows } = body;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      reply.code(400);
      return { ok: false, message: 'rows must contain at least one update' };
    }
    const access = requireScopedSheet(reply, sheet, await scopeOfRequest(threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const updates = rawRows.map((entry) => {
      const { row_key, row_id, order_no, ...patch } = entry;
      return {
        rowKey: String(row_key ?? row_id ?? order_no ?? ''),
        patch,
      };
    });
    // 变更日志:**改之前**先把旧值取出来 —— 事后再读就只剩新值了,"从什么改成什么"
    // 是 agent 唯一读不出来的那一半(见 table-edit-journal.ts)。
    const before = new Map<string, Record<string, unknown>>();
    for (const u of updates) {
      const row = getTableRow(u.rowKey, access.sheetId);
      if (row) before.set(u.rowKey, { ...row });
    }
    const result = await updateTableRows(updates, access.sheetId);
    if (!result.ok) {
      const notFound = /not found/i.test(result.message);
      reply.code(notFound ? 404 : 400);
      return { ok: false, message: result.message, rejected: result.rejected };
    }
    recordTableEdits({
      threadId,
      sheet: access.sheetId,
      by: 'human',                       // 这条路由是表格面板(人)在改;agent 走的是工具
      edits: updates.flatMap((u) =>
        Object.entries(u.patch).map(([column, to]) => ({
          rowKey: u.rowKey,
          column,
          from: before.get(u.rowKey)?.[column],
          to,
        })),
      ),
    });
    return {
      ok: true,
      sheet: result.sheet,
      rows: result.rows,
      updated: result.results.length,
    };
  });

  // 选区引用:前端圈选后登记,拿一个短 id 插进输入框。**不传数据** —— agent 拿 id 去
  // table_get 取当前值(见 table-selection.ts:引用是拉,变更是推)。
  app.post('/api/table/selection', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string; threadId?: string; rowKeys?: string[]; columns?: string[];
      groupBy?: string[]; filter?: string;
    };
    const access = requireScopedSheet(reply, body.sheet, await scopeOfRequest(body.threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const threadId = (body.threadId ?? '').trim();
    if (!threadId) {
      reply.code(400);
      return { ok: false, message: 'threadId is required — a selection belongs to a conversation' };
    }
    // **早失败**:这张表是别的项目加载来的时,现在就说清楚,而不是等 agent 事后
    // 讲道理(实测撞到过:圈了 4 行,agent 才回"这是上重的数据,不能用于锅炉厂")。
    // 判据用与 table_get 同一条 —— 两处口径必须一致。
    const pin = await resolveThreadPin(threadId, ctx);
    const source = getTableSheetMeta(access.sheetId)?.source;
    if (isProjectPinMismatch(source, pin, await listProjects(ctx.tenantId))) {
      reply.code(409);
      return {
        ok: false,
        message: `这张表是项目 ${source?.project ?? (isFileSource(source) ? source.fileName : source?.server)} 加载来的,`
          + '与当前会话的项目不一致 —— 请在当前项目下重新加载后再引用。',
      };
    }
    try {
      const sel = registerSelection({
        threadId,
        sheet: access.sheetId,
        rowKeys: Array.isArray(body.rowKeys) ? body.rowKeys.map(String) : [],
        columns: Array.isArray(body.columns) ? body.columns.map(String) : [],
        groupBy: Array.isArray(body.groupBy) ? body.groupBy.map(String) : [],
        filter: typeof body.filter === 'string' ? body.filter : '',
      });
      return { ok: true, id: sel.id, token: formatSelectionToken(sel) };
    } catch (e) {
      reply.code(400);
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * 快照:把当前 sheet 的内容写成一份**不可变文件**落进项目文件夹(spec §5)。
   * 连接器视图是会腐烂的缓存,这是"我要当时那一份"的唯一正解。
   */
  app.post('/api/table/snapshot', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { sheet?: string; threadId?: string };
    const scope = await scopeOfRequest(body.threadId, ctx);
    const access = requireScopedSheet(reply, body.sheet, scope);
    if (!isSheetAccess(access)) return access.error;

    const projectId = scope.kind === 'project' ? scope.id : null;
    const folder = projectId ? (await getProject(ctx.tenantId, projectId))?.folder : undefined;
    if (!folder) {
      reply.code(400);
      return {
        ok: false,
        message: projectId
          ? '当前项目没有绑定文件夹,快照没有地方放'
          : '个人区还没有项目文件夹,快照没有地方放',
      };
    }
    const meta = getTableSheetMeta(access.sheetId);
    try {
      const out = await writeSheetSnapshot({
        folder,
        sheetName: meta?.name ?? access.sheetId,
        columns: listTableColumns(access.sheetId).map((c) => ({ key: c.key, name: c.name })),
        rows: listTableRows(access.sheetId),
        origin: meta?.source ?? undefined,
      });
      return { ok: true, path: out.path, rows: out.rows };
    } catch (e: unknown) {
      reply.code(400);
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * 项目里到底有什么:文件(原件/快照)+ 连接器(带**上次刷新**)。
   * 两类分开说 —— 文件不会腐烂,连接器会,所以后者必须报新鲜度。
   */
  app.get('/api/project/context', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId, projectId: asked } = req.query as { threadId?: string; projectId?: string };
    // **项目页问的是它正在显示的那个项目**,不是当前线程钉着的那个 —— 后者会让
    // 页面显示另一个项目的上下文,而且看起来完全正常(实测)。
    const scope = await scopeOfRequest(threadId, ctx);
    const projectId = asked ?? (scope.kind === 'project' ? scope.id : null);
    const folder = projectId ? (await getProject(ctx.tenantId, projectId))?.folder : undefined;
    const sheets = listTableSheets(scope).map((m) => ({ name: m.name, source: m.source }));
    const connectors = summarizeConnectors(sheets);
    if (!folder) {
      return { ok: true, folder: null, originals: [], snapshots: [], connectors };
    }
    const files = await listProjectFiles(folder);
    void reply;
    return { ok: true, folder, ...files, connectors };
  });

  /**
   * 预览项目文件夹里的一个文件。
   *
   * 只读、只在这个项目的文件夹之内(readProjectFile 自己做路径包含校验)。
   * 表格类只回概览 —— 要筛选统计得导入后用 table_query,那才是能回答问题的形状;
   * 把几万行塞进预览面板既慢又没人读。
   */
  app.get('/api/project/file', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId, name, projectId: asked } = req.query as {
      threadId?: string; name?: string; projectId?: string;
    };
    if (!name) return reply.code(400).send({ error: '缺少 name' });
    const scope = await scopeOfRequest(threadId, ctx);
    const projectId = asked ?? (scope.kind === 'project' ? scope.id : null);
    const folder = projectId ? (await getProject(ctx.tenantId, projectId))?.folder : undefined;
    // 没有文件夹时不是"读失败",是**这个项目根本没有本地文件**。说清楚。
    if (!folder) return reply.code(404).send({ error: '这个项目还没有文件夹' });
    try {
      return { ok: true, ...(await readProjectFile(folder, name, { limit: 400 })) };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * 右侧文档面板按页取 PDF 图。**边界和 /api/project/file 共用一个函数** ——
   * 一个能画文件夹外文件的渲染接口,就是一个读任意文件的接口。
   */
  app.get('/api/project/file/page', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId, name, projectId: asked, page } = req.query as {
      threadId?: string; name?: string; projectId?: string; page?: string;
    };
    const n = Number(page);
    if (!name || !Number.isInteger(n)) return reply.code(400).send({ error: '缺少 name 或 page' });
    const scope = await scopeOfRequest(threadId, ctx);
    const projectId = asked ?? (scope.kind === 'project' ? scope.id : null);
    const folder = projectId ? (await getProject(ctx.tenantId, projectId))?.folder : undefined;
    if (!folder) return reply.code(404).send({ error: '这个项目还没有文件夹' });
    const dataUrl = await renderProjectFilePage(folder, name, n);
    // 画不出来就 404 —— 回一张空图会被当成"这一页是白的"。
    if (!dataUrl) return reply.code(404).send({ error: `画不出第 ${n} 页` });
    return { ok: true, dataUrl };
  });

  /** 在访达里显示项目文件夹里的某个东西(Show in Folder)。只允许文件夹之内。 */
  app.post('/api/project/reveal', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { path?: string; threadId?: string; projectId?: string };
    // **项目页没有 threadId。** 从前只按 threadId 反查项目,于是在项目页点
    // 「在访达中显示」会解析成个人区 → 拿不到文件夹 → 拒绝,而前端不吭声:
    // 用户看到的就是"点了没反应"(实测)。项目页知道自己是哪个项目,直接给。
    const scope = await scopeOfRequest(body.threadId, ctx);
    const projectId =
      (typeof body.projectId === 'string' && body.projectId ? body.projectId : null) ??
      (scope.kind === 'project' ? scope.id : null);
    const folder = projectId ? (await getProject(ctx.tenantId, projectId))?.folder : undefined;
    const target = String(body.path ?? '');
    const out = await revealInFileManager(folder, target || folder || '');
    if (!out.ok) reply.code(400);
    return out;
  });

  /** 文件夹里有哪些文件还没导入过(spec §6:只列,不自动吸收)。 */
  app.get('/api/table/inbox', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    const scope = await scopeOfRequest(threadId, ctx);
    const projectId = scope.kind === 'project' ? scope.id : null;
    const folder = projectId ? (await getProject(ctx.tenantId, projectId))?.folder : undefined;
    if (!folder) return { ok: true, pending: [], note: '当前作用域没有绑定文件夹' };
    const out = await scanProjectInbox(folder);
    return { ok: true, folder, pending: out.pending, ...(out.note ? { note: out.note } : {}) };
  });

  app.post('/api/table/import', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      threadId?: string;
      rows?: TableRowPatch[];
      column_names?: string[];
      new_column_names?: string[];
      /** 原件字节(base64)。有它才谈得上留档 —— 见 spec §3。 */
      file?: { name: string; base64: string };
      /** 它当初躺在哪儿(纯溯源) */
      fromPath?: string;
    };
    const access = requireScopedSheet(reply, body.sheet, await scopeOfRequest(body.threadId, ctx));
    if (!isSheetAccess(access)) {
      return access.error;
    }
    if (!Array.isArray(body.rows)) {
      reply.code(400);
      return { ok: false, message: 'rows is required' };
    }
    const columnNames =
      body.column_names ??
      body.new_column_names ??
      [];
    const result = importTableSheet(access.sheetId, columnNames, body.rows);
    // 用户导一张大表、紧接着关掉 app —— 响应必须意味着"已经在盘上了"
    await flushTablePersist();
    if (!result) {
      reply.code(400);
      return { ok: false, message: 'Import failed' };
    }

    // 导入即留档(spec 2026-08-14 §3):原件按内容哈希存进项目文件夹,sheet 记一根
    // 指向它的指针。留不成不是错误,是**要说出来的事实** —— 照实回给前端。
    const projectId = access.scope.kind === 'project' ? access.scope.id : null;
    const folder = projectId
      ? (await getProject(ctx.tenantId, projectId))?.folder
      : undefined;
    const archive = await archiveImportedFile({
      folder, projectId, file: body.file, fromPath: body.fromPath,
    });
    if (archive.source) {
      await stampTableSheetSource(access.sheetId, archive.source).catch((e: unknown) => {
        console.error('[table] file-source stamp failed:', e);
      });
    }
    return {
      ok: true,
      sheet: access.sheetId,
      columns: result.columns,
      rows: result.rows,
      // 留档结果照实回:archived=false 时 reason 是人话,前端原样显示。
      archived: archive.archived,
      ...(archive.archived ? { original: { hash: archive.source!.fileHash, name: archive.source!.fileName } } : {}),
      ...(archive.reason ? { archiveNote: archive.reason } : {}),
    };
  });
}
