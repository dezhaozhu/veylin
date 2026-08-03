import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  getTableSheetMeta,
  importTableSheet,
  isTableSheetNameTaken,
  listTableColumns,
  listTableRows,
  listTableSheets,
  renameTableSheet,
  resolveTableSheetId,
  sheetBelongsToThread,
  updateTableRows,
  DEFAULT_TABLE_SHEET,
  onTableEvent,
  type TableRowPatch,
  type TableEvent,
} from '../table-store.js';
import type { ServerDeps } from './types.js';
import {
  unwrapMcpPayload,
  importCompassScheduleSheet,
  type CompassLoadScope,
} from '../table-tools.js';
import { resolveCompassServer } from '../mcp-scoping.js';
import { resolveThreadPin } from '../thread-state.js';
import { resolvePinnedProjectScope } from '../project-store.js';
import { getPooledCompassToolsets, type CompassPoolDeps } from '../compass-pool.js';
import {
  proposeScheduleEdit,
  previewScheduleEdit,
  commitScheduleEdit,
  discardScheduleEdits,
  type ProposeEditBody,
} from '../schedule-edit.js';

// Fork seam: threadId is OPTIONAL on these routes. Sessions (dezhao's per-thread
// sheet tabs) pass it and see global + their own sheets; our workspace AG-Grid
// omits it and operates on the workspace scope (global sheets only). Session
// sheets remain inaccessible without their matching threadId.
function requireThreadId(
  _reply: FastifyReply,
  threadId: string | undefined | null,
): string | null {
  return threadId?.trim() || null;
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
 * Exported (with injectable seams, compass-pool deps style) as the testable
 * seam — no HTTP harness exists in this repo (see tables-thread-pin.test.ts).
 */
export type CompassRequestScope = {
  getToolsets: () => Record<string, unknown>;
  entryPin: string | null;
  projectId: string | null;
  /** Scope for importCompassScheduleSheet; undefined = tenant-getter fallback (no pin). */
  loadScope: CompassLoadScope | undefined;
};

export async function resolveCompassRequestScope(
  threadId: string | undefined,
  ctx: { tenantId: string; userId: string },
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
  return {
    getToolsets: () => record,
    entryPin: scope.entryPin,
    projectId: scope.project.id,
    loadScope: { toolsets: record, entryPin: scope.entryPin, projectId: scope.project.id },
  };
}

type SheetAccess = { sheetId: string; threadId: string | null };

/** Resolve sheet and enforce thread ownership (global sheets pass any scope). */
function requireThreadSheet(
  reply: FastifyReply,
  sheetParam: string | undefined,
  threadId: string | undefined | null,
): SheetAccess | { error: { ok: false; message: string } } {
  const scoped = threadId?.trim() || null;
  const sheetId = resolveTableSheetId(sheetParam);
  if (!sheetBelongsToThread(sheetId, scoped)) {
    reply.code(404);
    return { error: { ok: false, message: 'sheet not found' } };
  }
  return { sheetId, threadId: scoped };
}

function isSheetAccess(
  value: SheetAccess | { error: { ok: false; message: string } },
): value is SheetAccess {
  return 'sheetId' in value;
}

export function registerTablesRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // Editable multi-sheet table dataset for the right-panel data grid.
  app.get('/api/table', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { sheet, threadId } = req.query as { sheet?: string; threadId?: string };
    const access = requireThreadSheet(reply, sheet, threadId);
    if (!isSheetAccess(access)) {
      return access.error;
    }
    return {
      sheet: access.sheetId,
      sheets: listTableSheets(access.threadId),
      defaultSheet: DEFAULT_TABLE_SHEET,
      columns: listTableColumns(access.sheetId),
      rows: listTableRows(access.sheetId),
    };
  });

  // Server-Sent Events: push row-level table changes so the client can drop its 4s
  // full-sheet poll and apply surgical AG-Grid transactions (cost independent of size).
  app.get('/api/table/stream', async (req, reply) => {
    await deps.resolveContext(req.headers);
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
    // Refresh the schedule sheet from Compass so the grid shows the new run
    // (importTableSheet emits sheetReplace → SSE → client refetch).
    // Best-effort: the commit already happened — never turn a refresh failure into an error response.
    try {
      await importCompassScheduleSheet(deps.getMcpToolsets, {}, deps.getMcpGroups, scope.loadScope);
    } catch {
      /* best-effort refresh; grid converges on next manual load */
    }
    return out;
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
    await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    const scoped = requireThreadId(reply, threadId);
    return { ok: true, sheets: listTableSheets(scoped) };
  });

  app.post('/api/table/sheets', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { name, threadId } = (req.body ?? {}) as { name?: string; threadId?: string };
    const trimmed = name?.trim();
    const scoped = requireThreadId(reply, threadId);
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
    await deps.resolveContext(req.headers);
    const { sheetId } = req.params as { sheetId: string };
    const { threadId } = req.query as { threadId?: string };
    const scoped = requireThreadId(reply, threadId);
    const existing = getTableSheetMeta(sheetId);
    if (!existing || (existing.threadId ?? '') !== (scoped ?? '')) {
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
    await deps.resolveContext(req.headers);
    const { sheetId } = req.params as { sheetId: string };
    const { name, threadId } = (req.body ?? {}) as { name?: string; threadId?: string };
    const trimmed = name?.trim();
    if (!trimmed) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const scoped = requireThreadId(reply, threadId);
    const existing = getTableSheetMeta(sheetId);
    if (!existing || (existing.threadId ?? '') !== (scoped ?? '')) {
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
    await deps.resolveContext(req.headers);
    const { sheet, threadId } = (req.body ?? {}) as { sheet?: string; threadId?: string };
    const access = requireThreadSheet(reply, sheet, threadId);
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
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      threadId?: string;
      row_keys?: string[];
      order_nos?: string[];
    };
    const access = requireThreadSheet(reply, body.sheet, body.threadId);
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const rowKeys = body.row_keys ?? body.order_nos ?? [];
    const { removed } = deleteTableRows(access.sheetId, rowKeys);
    return { ok: true, sheet: access.sheetId, removed, rows: listTableRows(access.sheetId) };
  });

  app.post('/api/table/columns', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { sheet, name, threadId } = (req.body ?? {}) as {
      sheet?: string;
      name?: string;
      threadId?: string;
    };
    const access = requireThreadSheet(reply, sheet, threadId);
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
    await deps.resolveContext(req.headers);
    const { sheet, key, threadId } = (req.body ?? {}) as {
      sheet?: string;
      key?: string;
      threadId?: string;
    };
    const access = requireThreadSheet(reply, sheet, threadId);
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
    await deps.resolveContext(req.headers);
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
    const access = requireThreadSheet(reply, sheet, threadId);
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
    const result = await updateTableRows(updates, access.sheetId);
    if (!result.ok) {
      const notFound = /not found/i.test(result.message);
      reply.code(notFound ? 404 : 400);
      return { ok: false, message: result.message, rejected: result.rejected };
    }
    return {
      ok: true,
      sheet: result.sheet,
      rows: result.rows,
      updated: result.results.length,
    };
  });

  app.post('/api/table/import', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      threadId?: string;
      rows?: TableRowPatch[];
      column_names?: string[];
      new_column_names?: string[];
    };
    const access = requireThreadSheet(reply, body.sheet, body.threadId);
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
    if (!result) {
      reply.code(400);
      return { ok: false, message: 'Import failed' };
    }
    return {
      ok: true,
      sheet: access.sheetId,
      columns: result.columns,
      rows: result.rows,
    };
  });
}
