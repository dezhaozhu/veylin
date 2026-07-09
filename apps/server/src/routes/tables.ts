import type { FastifyInstance } from 'fastify';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  importTableSheet,
  listTableColumns,
  listTableRows,
  listTableSheets,
  resolveTableSheetId,
  updateTableRow,
  DEFAULT_TABLE_SHEET,
  onTableEvent,
  type TableRowPatch,
  type TableEvent,
} from '../table-store.js';
import type { ServerDeps } from './types.js';

export function registerTablesRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // Editable multi-sheet table dataset for the right-panel data grid.
  app.get('/api/table', async (req) => {
    await deps.resolveContext(req.headers);
    const { sheet } = req.query as { sheet?: string };
    const sheetId = resolveTableSheetId(sheet);
    return {
      sheet: sheetId,
      sheets: listTableSheets(),
      defaultSheet: DEFAULT_TABLE_SHEET,
      columns: listTableColumns(sheetId),
      rows: listTableRows(sheetId),
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

  app.post('/api/table/sheets', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name?.trim()) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const sheet = createTableSheet(name);
    if (!sheet) {
      reply.code(400);
      return { ok: false, message: 'Failed to create sheet' };
    }
    return { ok: true, sheet, sheets: listTableSheets() };
  });

  app.delete('/api/table/sheets/:sheetId', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { sheetId } = req.params as { sheetId: string };
    const ok = await deleteTableSheet(sheetId);
    if (!ok) {
      reply.code(400);
      return { ok: false, message: 'Failed to delete sheet' };
    }
    const sheets = listTableSheets();
    const nextSheet = sheets[0]?.id ?? DEFAULT_TABLE_SHEET;
    return { ok: true, sheets, nextSheet };
  });

  app.post('/api/table/rows', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { sheet } = (req.body ?? {}) as { sheet?: string };
    const sheetId = resolveTableSheetId(sheet);
    const row = addTableRow(sheetId);
    if (!row) {
      reply.code(400);
      return { ok: false, message: 'Failed to add row' };
    }
    return { ok: true, sheet: sheetId, row, rows: listTableRows(sheetId) };
  });

  app.delete('/api/table/rows', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      row_keys?: string[];
      order_nos?: string[];
    };
    const sheetId = resolveTableSheetId(body.sheet);
    const rowKeys = body.row_keys ?? body.order_nos ?? [];
    const removed = deleteTableRows(sheetId, rowKeys);
    return { ok: true, sheet: sheetId, removed, rows: listTableRows(sheetId) };
  });

  app.post('/api/table/columns', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { sheet, name } = (req.body ?? {}) as { sheet?: string; name?: string };
    const sheetId = resolveTableSheetId(sheet);
    if (!name?.trim()) {
      reply.code(400);
      return { ok: false, message: 'name is required' };
    }
    const column = addTableColumn(sheetId, name);
    if (!column) {
      reply.code(400);
      return { ok: false, message: 'Failed to add column' };
    }
    return {
      ok: true,
      sheet: sheetId,
      column,
      columns: listTableColumns(sheetId),
      rows: listTableRows(sheetId),
    };
  });

  app.delete('/api/table/columns', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const { sheet, key } = (req.body ?? {}) as { sheet?: string; key?: string };
    const sheetId = resolveTableSheetId(sheet);
    if (!key || !deleteTableColumn(sheetId, key)) {
      reply.code(400);
      return { ok: false, message: 'Failed to delete column' };
    }
    return {
      ok: true,
      sheet: sheetId,
      columns: listTableColumns(sheetId),
      rows: listTableRows(sheetId),
    };
  });

  app.patch('/api/table', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as {
      sheet?: string;
      row_key?: string;
      row_id?: string;
      order_no?: string;
    } & TableRowPatch;
    const { sheet, row_key, row_id, order_no, ...patch } = body;
    const key = row_key ?? row_id ?? order_no;
    if (key == null || key === '') {
      reply.code(400);
      return { ok: false, message: 'row_key is required' };
    }
    const sheetId = resolveTableSheetId(sheet);
    const result = await updateTableRow(key, patch, sheetId);
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
      rows?: TableRowPatch[];
      column_names?: string[];
      new_column_names?: string[];
    };
    const sheetId = resolveTableSheetId(body.sheet);
    if (!Array.isArray(body.rows)) {
      reply.code(400);
      return { ok: false, message: 'rows is required' };
    }
    const columnNames =
      body.column_names ??
      body.new_column_names ??
      [];
    const result = importTableSheet(sheetId, columnNames, body.rows);
    if (!result) {
      reply.code(400);
      return { ok: false, message: 'Import failed' };
    }
    return {
      ok: true,
      sheet: sheetId,
      columns: result.columns,
      rows: result.rows,
    };
  });


}
