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
import { unwrapMcpPayload, importCompassScheduleSheet } from '../table-tools.js';
import { resolveCompassServer } from '../mcp-scoping.js';
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
    await deps.resolveContext(req.headers);
    const { order_id, wbs, stage_code, material, limit } = req.query as {
      order_id?: string;
      wbs?: string;
      stage_code?: string;
      material?: string;
      limit?: string;
    };
    // pin: null — this read-only master-detail lookup is workspace-grid-scoped
    // like the rest of this route file (see the Fork seam note above): the
    // request carries no threadId to resolve a pin against. resolveCompassServer
    // still guards it — with more than one Compass-prefixed server connected it
    // refuses rather than guessing 'compass' and crossing a project boundary.
    const serverName = resolveCompassServer(deps.getMcpToolsets(), deps.getMcpGroups(), null);
    const compass = serverName
      ? (deps.getMcpToolsets()[serverName] as
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
  // pin: null on every route below — the workspace grid panel these back is
  // thread-agnostic (see the Fork seam note above the routes at the top of this
  // file): none of these requests carry a threadId to resolve a pin against.
  // deps.getMcpGroups() is still passed through so resolveCompassServer can
  // refuse (rather than silently guess 'compass') when a grouped deployment has
  // more than one Compass-prefixed server connected — an honest "not connected"
  // beats a governed WRITE landing on the wrong tenant's Compass server.
  // ------------------------------------------------------------------
  app.post('/api/schedule-edit/propose', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as ProposeEditBody;
    const out = await proposeScheduleEdit(deps.getMcpToolsets, body, deps.getMcpGroups(), null);
    if (!out.ok) reply.code('refused' in out && out.refused ? 403 : 503);
    return out;
  });

  app.post('/api/schedule-edit/preview', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const out = await previewScheduleEdit(deps.getMcpToolsets, deps.getMcpGroups(), null);
    if (!out.ok) reply.code(503);
    return out;
  });

  app.post('/api/schedule-edit/commit', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const out = await commitScheduleEdit(deps.getMcpToolsets, deps.getMcpGroups(), null);
    if (!out.ok) {
      reply.code('conflict' in out && out.conflict ? 409 : 503);
      return out;
    }
    // Refresh the schedule sheet from Compass so the grid shows the new run
    // (importTableSheet emits sheetReplace → SSE → client refetch).
    // Best-effort: the commit already happened — never turn a refresh failure into an error response.
    try {
      await importCompassScheduleSheet(deps.getMcpToolsets, {}, deps.getMcpGroups);
    } catch {
      /* best-effort refresh; grid converges on next manual load */
    }
    return out;
  });

  app.post('/api/schedule-edit/discard', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const out = await discardScheduleEdits(deps.getMcpToolsets, deps.getMcpGroups(), null);
    if (!out.ok) {
      reply.code(503);
      return out;
    }
    // Re-import to revert the grid's optimistic cell echoes back to canonical.
    // Best-effort: the discard already happened — never turn a refresh failure into an error response.
    try {
      await importCompassScheduleSheet(deps.getMcpToolsets, {}, deps.getMcpGroups);
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
    };
    // pin: null — see the note above; the grid load button is not thread-scoped.
    const result = await importCompassScheduleSheet(deps.getMcpToolsets, body, deps.getMcpGroups);
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
