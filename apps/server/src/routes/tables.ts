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
  type TableRowPatch,
} from '../table-store.js';
import type { ServerDeps } from './types.js';
import { unwrapMcpPayload } from '../table-tools.js';

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
    const compass = deps.getMcpToolsets()['compass'] as
      | Record<string, { execute: (args: unknown) => Promise<unknown> }>
      | undefined;
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
    const row = await updateTableRow(key, patch, sheetId);
    if (!row) {
      reply.code(404);
      return { ok: false, message: 'Row not found' };
    }
    return { ok: true, sheet: sheetId, row };
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
