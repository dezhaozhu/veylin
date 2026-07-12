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
  updateTableRow,
  DEFAULT_TABLE_SHEET,
  onTableEvent,
  type TableRowPatch,
  type TableEvent,
} from '../table-store.js';
import type { ServerDeps } from './types.js';

function requireThreadId(
  reply: FastifyReply,
  threadId: string | undefined | null,
): string | null {
  const scoped = threadId?.trim();
  if (!scoped) {
    reply.code(400);
    return null;
  }
  return scoped;
}

type SheetAccess = { sheetId: string; threadId: string };

/** Resolve sheet and enforce thread ownership. Returns null after writing an error reply. */
function requireThreadSheet(
  reply: FastifyReply,
  sheetParam: string | undefined,
  threadId: string | undefined | null,
): SheetAccess | { error: { ok: false; message: string } } {
  const scoped = threadId?.trim();
  if (!scoped) {
    reply.code(400);
    return { error: { ok: false, message: 'threadId is required' } };
  }
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
  // full-sheet poll and apply surgical row updates (cost independent of size).
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

  // Lightweight sheet-tab list (no row payload) — used after sheetsChange SSE.
  app.get('/api/table/sheets', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    const scoped = requireThreadId(reply, threadId);
    if (!scoped) {
      return { ok: false, message: 'threadId is required' };
    }
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
    if (!scoped) {
      return { ok: false, message: 'threadId is required' };
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
    if (!scoped) {
      return { ok: false, message: 'threadId is required' };
    }
    const existing = getTableSheetMeta(sheetId);
    if (!existing || (existing.threadId ?? '') !== scoped) {
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
    if (!scoped) {
      return { ok: false, message: 'threadId is required' };
    }
    const existing = getTableSheetMeta(sheetId);
    if (!existing || (existing.threadId ?? '') !== scoped) {
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

  app.patch('/api/table', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      threadId?: string;
      row_key?: string;
      row_id?: string;
      order_no?: string;
    } & TableRowPatch;
    const { sheet, threadId, row_key, row_id, order_no, ...patch } = body;
    const key = row_key ?? row_id ?? order_no;
    if (key == null || key === '') {
      reply.code(400);
      return { ok: false, message: 'row_key is required' };
    }
    const access = requireThreadSheet(reply, sheet, threadId);
    if (!isSheetAccess(access)) {
      return access.error;
    }
    const result = await updateTableRow(key, patch, access.sheetId);
    if (!result.ok) {
      reply.code(result.row ? 400 : 404);
      return { ok: false, message: result.message, rejected: result.rejected };
    }
    return { ok: true, sheet: result.sheet, row: result.row };
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
