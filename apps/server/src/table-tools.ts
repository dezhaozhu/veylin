import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  DEFAULT_TABLE_GET_LIMIT,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  emitTableChart,
  importTableSheet,
  listTableColumns,
  listTableRowsPage,
  listTableSheets,
  MAX_TABLE_GET_LIMIT,
  resolveTableSheetId,
  updateTableRow,
} from './table-store';

const rowSchema = z.record(z.string(), z.union([z.string(), z.number()]));
const cellValueSchema = z.union([z.string(), z.number()]);

import { unwrapMcpPayload } from './mcp-payload.js';

export { unwrapMcpPayload } from './mcp-payload.js';

export type ToolsetsGetter = () => Record<string, unknown>;

/**
 * Fetch schedule rows from the Compass `get_schedule_rows` MCP tool and import
 * them into the `schedule` sheet. Shared by the load_compass_schedule agent tool
 * and the /api/schedule-edit commit/discard routes (grid refresh after a draft
 * lands or is rolled back).
 */
export const SCHEDULE_SHEET_ID = 'schedule';

export async function importCompassScheduleSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
  input: { limit?: number; workshop?: string; status?: string; order_id?: string },
): Promise<
  | { ok: true; sheet: string; imported: number; total: number; columns: number }
  | { ok: false; error: string }
> {
  // Resolve live toolsets via the getter (not a snapshot — rebuildMcp re-assigns the var)
  const toolsets = getMcpToolsets?.() ?? {};
  const compass = toolsets['compass'] as
    | Record<string, { execute: (args: unknown) => Promise<unknown> }>
    | undefined;
  const tool = compass?.['get_schedule_rows'];
  if (!tool) {
    return {
      ok: false as const,
      error: 'compass MCP server not connected (no get_schedule_rows)',
    };
  }

  // Load the FULL result set into the grid sheet (not just 500). This is safe for
  // the agent's context: importCompassScheduleSheet returns only a summary
  // (imported/total counts), never the rows — the rows go straight into the grid.
  // The grid paginates them client-side. An explicit input.limit still wins.
  const res: unknown = await tool.execute({
    limit: input.limit ?? 1_000_000,
    workshop: input.workshop,
    status: input.status,
    order_id: input.order_id,
  });

  const payload = unwrapMcpPayload(res);

  const columns = (payload['columns'] as Array<Record<string, unknown>> | undefined) ?? [];
  const rows = (payload['rows'] as Array<Record<string, unknown>> | undefined) ?? [];

  // Ensure the 'schedule' sheet exists (create on first use; fire-and-forget persist is fine)
  const existingSheets = listTableSheets();
  if (!existingSheets.find((s) => s.id === SCHEDULE_SHEET_ID)) {
    createTableSheet(SCHEDULE_SHEET_ID);
  }

  // Build rich column descriptors from Compass's typed columns: friendly display
  // name + type + (for status columns) the real option set — so the grid shows
  // readable headers and colored status badges without blanking derived/solved.
  const descriptors = columns
    .map((c) => {
      const key = String(c['key'] ?? '');
      if (!key) return null;
      const rawType = c['type'];
      const type: 'text' | 'number' | 'status' =
        rawType === 'number' ? 'number' : rawType === 'status' ? 'status' : 'text';
      const opts = c['options'];
      const sem = c['semantics'];
      return {
        key,
        name: String(c['name'] ?? key),
        type,
        statusOptions: type === 'status' && Array.isArray(opts) ? (opts as string[]) : undefined,
        semantics:
          type === 'status' && sem && typeof sem === 'object'
            ? (sem as Record<string, string>)
            : undefined,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const result = importTableSheet(
    SCHEDULE_SHEET_ID,
    [],
    rows as Array<Record<string, string | number>>,
    undefined,
    descriptors,
  );

  return {
    ok: true as const,
    sheet: SCHEDULE_SHEET_ID,
    imported: rows.length,
    total: (payload['total'] as number | undefined) ?? rows.length,
    columns: result?.columns?.length ?? columns.length,
  };
}

export const RESOURCES_SHEET_ID = 'resources';

export async function importCompassResourceSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
): Promise<
  | { ok: true; sheet: string; imported: number }
  | { ok: false; error: string }
> {
  const toolsets = getMcpToolsets?.() ?? {};
  const compass = toolsets['compass'] as
    | Record<string, { execute: (args: unknown) => Promise<unknown> }>
    | undefined;
  const tool = compass?.['get_resources'];
  if (!tool) {
    return { ok: false as const, error: 'compass MCP server not connected (no get_resources)' };
  }

  const res: unknown = await tool.execute({});
  const payload = unwrapMcpPayload(res);
  const resources =
    (payload['resources'] as Array<Record<string, unknown>> | undefined) ?? [];

  if (!listTableSheets().find((s) => s.id === RESOURCES_SHEET_ID)) {
    createTableSheet(RESOURCES_SHEET_ID);
  }

  // Compass's per-resource `trend` is a 12-month forward load series (array);
  // store it as the sparkline column's comma-separated form.
  const rows = resources.map((r) => ({
    resource: String(r['resource'] ?? ''),
    trend: Array.isArray(r['trend']) ? (r['trend'] as number[]).join(',') : '',
    current_k: (r['current_k'] as number | null) ?? '',
    suggested_min_k: (r['suggested_min_k'] as number | null) ?? '',
    jobs: (r['jobs'] as number | null) ?? '',
    load_days: (r['load_days'] as number | null) ?? '',
    source: String(r['source'] ?? ''),
  }));

  const descriptors = [
    { key: 'resource', name: '资源', type: 'text' as const },
    { key: 'trend', name: '负荷趋势(12月)', type: 'sparkline' as const },
    { key: 'current_k', name: '当前K', type: 'number' as const },
    { key: 'suggested_min_k', name: '建议最小K', type: 'number' as const },
    { key: 'jobs', name: '工序数', type: 'number' as const },
    { key: 'load_days', name: '负荷(天)', type: 'number' as const },
    { key: 'source', name: '来源', type: 'text' as const },
  ];
  importTableSheet(RESOURCES_SHEET_ID, [], rows, undefined, descriptors);
  return { ok: true as const, sheet: RESOURCES_SHEET_ID, imported: rows.length };
}

export const ORDERS_SHEET_ID = 'orders';

// Per-order overview: one row per 订单 (aggregated from the per-工序 schedule rows).
// Master-detail on this sheet reuses the schedule-detail fetch, but since order
// rows carry order_id and NO stage_code, it returns the order's FULL 三级 route.
export async function importCompassOrderSheet(
  getMcpToolsets: ToolsetsGetter | undefined,
): Promise<
  | { ok: true; sheet: string; imported: number; total: number; columns: number }
  | { ok: false; error: string }
> {
  const toolsets = getMcpToolsets?.() ?? {};
  const compass = toolsets['compass'] as
    | Record<string, { execute: (args: unknown) => Promise<unknown> }>
    | undefined;
  const tool = compass?.['get_schedule_rows'];
  if (!tool) {
    return { ok: false as const, error: 'compass MCP server not connected (no get_schedule_rows)' };
  }
  const res: unknown = await tool.execute({ limit: 1_000_000 });
  const payload = unwrapMcpPayload(res);
  const rows = (payload['rows'] as Array<Record<string, unknown>> | undefined) ?? [];

  // Aggregate the per-工序 rows into one row per order.
  const STATUS_RANK: Record<string, number> = { unscheduled: 3, derived: 2, solved: 1 };
  type Agg = {
    order_id: string; product_class: string; due_at: string | null; end: string | null;
    schedule_status: string; workshops: Set<string>; stage_count: number; _wo_count: number;
  };
  const byOrder = new Map<string, Agg>();
  for (const r of rows) {
    const oid = String(r['order_id'] ?? '');
    if (!oid) continue;
    let o = byOrder.get(oid);
    if (!o) {
      o = {
        order_id: oid, product_class: String(r['product_class'] ?? ''),
        due_at: (r['due_at'] as string | null) ?? null, end: null,
        schedule_status: 'solved', workshops: new Set(), stage_count: 0,
        _wo_count: Number(r['_wo_count'] ?? 0),
      };
      byOrder.set(oid, o);
    }
    o.stage_count += 1;
    if (r['workshop']) o.workshops.add(String(r['workshop']));
    const end = r['end'] as string | null;
    if (end && (!o.end || String(end) > String(o.end))) o.end = end;   // latest stage end = order 完工
    const st = String(r['schedule_status'] ?? 'solved');
    if ((STATUS_RANK[st] ?? 0) > (STATUS_RANK[o.schedule_status] ?? 0)) o.schedule_status = st;
  }
  const orderRows = [...byOrder.values()].map((o) => ({
    order_id: o.order_id, product_class: o.product_class, workshop: [...o.workshops].join('/'),
    stage_count: o.stage_count, schedule_status: o.schedule_status,
    end: o.end, due_at: o.due_at, _wo_count: o._wo_count,
  }));

  // Reuse the schedule_status tone map Compass shipped on the source columns, so the
  // orders sheet colours identically to the schedule sheet — no domain map re-hardcoded here.
  const srcColumns = (payload['columns'] as Array<Record<string, unknown>> | undefined) ?? [];
  const srcSem = srcColumns.find((c) => c['key'] === 'schedule_status')?.['semantics'];
  const statusSemantics =
    srcSem && typeof srcSem === 'object' ? (srcSem as Record<string, string>) : undefined;
  const descriptors = [
    { key: 'order_id', name: '订单号', type: 'text' as const },
    { key: 'product_class', name: '产品', type: 'text' as const },
    { key: 'workshop', name: '分厂', type: 'text' as const },
    { key: 'stage_count', name: '工序数', type: 'number' as const },
    { key: 'schedule_status', name: '排产状态', type: 'status' as const, semantics: statusSemantics },
    { key: 'end', name: '计划完工', type: 'text' as const },
    { key: 'due_at', name: '交期', type: 'text' as const },
  ];
  if (!listTableSheets().find((s) => s.id === ORDERS_SHEET_ID)) createTableSheet(ORDERS_SHEET_ID);
  importTableSheet(ORDERS_SHEET_ID, [], orderRows as Array<Record<string, string | number>>, undefined, descriptors);
  return {
    ok: true as const, sheet: ORDERS_SHEET_ID,
    imported: orderRows.length, total: orderRows.length, columns: descriptors.length,
  };
}

/**
 * Generic spreadsheet/table tools backed by the multi-sheet grid store.
 */
export function buildTableTools(getMcpToolsets?: ToolsetsGetter) {
  const tableGet = createTool({
    id: 'table_get',
    description:
      'Read rows and column definitions from a table sheet (paginated). ' +
      'Always check totalRows in the response; call again with offset/limit for more. ' +
      'Call table_list_sheets first if sheet id is unknown.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(`Row offset for pagination (default 0).`),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_TABLE_GET_LIMIT)
        .optional()
        .describe(`Rows per page (default ${DEFAULT_TABLE_GET_LIMIT}, max ${MAX_TABLE_GET_LIMIT}).`),
    }),
    outputSchema: z.object({
      sheet: z.string(),
      totalRows: z.number(),
      offset: z.number(),
      limit: z.number(),
      hasMore: z.boolean(),
      columns: z.array(
        z.object({ key: z.string(), name: z.string(), type: z.string() }),
      ),
      rows: z.array(rowSchema),
      notice: z.string().optional(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      // z.coerce.number() already validated string→number; Number() re-narrows the
      // zod-v4 `unknown` input type to a clean number (idempotent at runtime).
      const offset = Number(input.offset ?? 0);
      const limit = Number(input.limit ?? DEFAULT_TABLE_GET_LIMIT);
      const { totalRows, rows } = listTableRowsPage(sheet, offset, limit);
      const hasMore = offset + rows.length < totalRows;
      return {
        sheet,
        totalRows,
        offset,
        limit,
        hasMore,
        columns: listTableColumns(sheet).map((c) => ({
          key: c.key,
          name: c.name,
          type: c.type,
        })),
        rows,
        ...(hasMore
          ? {
              notice:
                `Showing rows ${offset + 1}–${offset + rows.length} of ${totalRows}. ` +
                `Call table_get again with offset=${offset + rows.length} for the next page.`,
            }
          : totalRows === 0
            ? {
                notice:
                  'This sheet has zero rows in the server table store. ' +
                  'If the UI shows data, confirm the correct sheet id via table_list_sheets.',
              }
            : {}),
      };
    },
  });

  const tableUpdateRow = createTool({
    id: 'table_update_row',
    description:
      'Update multiple cells on one row. Identify the row with row_key (row_id or primary key column value).',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z.string().describe('Row id or primary key value from table_get.'),
      values: rowSchema.describe('Column key → new value. Only include columns to change.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const updated = await updateTableRow(input.row_key, input.values, sheet);
      if (!updated) {
        return { ok: false, sheet, row: null, message: `Row ${input.row_key} not found` };
      }
      return { ok: true, sheet, row: updated, message: `Updated row ${input.row_key}` };
    },
  });

  const tableSetCell = createTool({
    id: 'table_set_cell',
    description:
      'Write a single cell. Use row_key from table_get; column is a column key from the same sheet.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z.string().describe('Row id or primary key value.'),
      column: z.string().describe('Column key to write.'),
      value: cellValueSchema.describe('New cell value.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const updated = await updateTableRow(
        input.row_key,
        { [input.column]: input.value },
        sheet,
      );
      if (!updated) {
        return { ok: false, sheet, row: null, message: `Row ${input.row_key} not found` };
      }
      return {
        ok: true,
        sheet,
        row: updated,
        message: `Updated ${input.row_key}.${input.column}`,
      };
    },
  });

  const tableAddRow = createTool({
    id: 'table_add_row',
    description: 'Append a blank row. Returns row_key for table_set_cell / table_update_row.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const row = addTableRow(sheet);
      if (!row) return { ok: false, sheet, row: null, message: 'Failed to add row' };
      return { ok: true, sheet, row, message: 'Added a blank row' };
    },
  });

  const tableDeleteRows = createTool({
    id: 'table_delete_rows',
    description: 'Delete rows by row_key values.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_keys: z.array(z.string()).min(1).describe('Row ids or primary keys to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      removed: z.number(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const removed = deleteTableRows(sheet, input.row_keys);
      return { ok: removed > 0, sheet, removed, message: `Deleted ${removed} row(s)` };
    },
  });

  const tableAddColumn = createTool({
    id: 'table_add_column',
    description: 'Add a new text column to a sheet.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      name: z.string().describe('Column display name.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      column: z.object({ key: z.string(), name: z.string() }).nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const column = addTableColumn(sheet, input.name);
      if (!column) return { ok: false, sheet, column: null, message: 'Failed to add column' };
      return {
        ok: true,
        sheet,
        column: { key: column.key, name: column.name },
        message: `Added column ${column.name}`,
      };
    },
  });

  const tableDeleteColumn = createTool({
    id: 'table_delete_column',
    description: 'Delete a column by its key. Frozen columns cannot be deleted.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      column: z.string().describe('Column key to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const ok = deleteTableColumn(sheet, input.column);
      return {
        ok,
        sheet,
        message: ok ? `Deleted column ${input.column}` : `Failed to delete column ${input.column}`,
      };
    },
  });

  const tableCreateSheet = createTool({
    id: 'table_create_sheet',
    description: 'Create a new sheet (tab) with the default column schema.',
    inputSchema: z.object({
      name: z.string().describe('Sheet display name.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.object({ id: z.string(), name: z.string() }).nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = createTableSheet(input.name);
      if (!sheet) return { ok: false, sheet: null, message: 'Failed to create sheet' };
      return { ok: true, sheet: { id: sheet.id, name: sheet.name }, message: `Created sheet ${sheet.name}` };
    },
  });

  const tableDeleteSheet = createTool({
    id: 'table_delete_sheet',
    description: 'Delete a sheet by id. At least one sheet must remain.',
    inputSchema: z.object({
      sheet: z.string().describe('Sheet id to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
    execute: async (input) => {
      const ok = await deleteTableSheet(input.sheet);
      return { ok, message: ok ? `Deleted sheet ${input.sheet}` : 'Failed to delete sheet' };
    },
  });

  const tableListSheets = createTool({
    id: 'table_list_sheets',
    description: 'List available table sheets (tabs).',
    inputSchema: z.object({}),
    outputSchema: z.object({
      sheets: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          builtin: z.boolean(),
        }),
      ),
    }),
    execute: async () => ({ sheets: listTableSheets() }),
  });

  const loadCompassSchedule = createTool({
    id: 'load_compass_schedule',
    description:
      '从 Compass 拉取本租户的排产网格行，写入名为 schedule 的表 sheet 供展示。' +
      ' 需要 Compass MCP 服务器已连接。',
    inputSchema: z.object({
      limit: z.coerce.number().int().min(1).optional().describe('最多返回多少行（默认 500）'),
      workshop: z.string().optional().describe('按车间过滤'),
      status: z.string().optional().describe('按状态过滤'),
      order_id: z.string().optional().describe('按订单号过滤'),
    }),
    execute: async (input) =>
      importCompassScheduleSheet(getMcpToolsets, {
        ...input,
        limit: input.limit == null ? undefined : Number(input.limit),
      }),
  });

  const tableChart = createTool({
    id: 'table_chart',
    description:
      '在表格面板上就地生成一张图表（AG-Grid 集成图表）。给定 sheet 与列名，' +
      '第一列作为类目轴，其余数值列作为序列。适合"画个各资源负荷图"这类请求。',
    inputSchema: z.object({
      sheet: z.string().optional().describe('sheet 名（默认当前主 sheet）'),
      columns: z
        .array(z.string())
        .min(2)
        .describe('参与图表的列 key（第一列=类目，如 ["resource","load_days"]）'),
      chart_type: z
        .enum(['column', 'bar', 'line', 'area', 'pie'])
        .optional()
        .describe('图表类型，默认 column'),
      agg_func: z
        .enum(['sum', 'avg', 'min', 'max', 'count'])
        .optional()
        .describe('数值聚合（配合分组时用）'),
    }),
    execute: async (input) => {
      const sheet = resolveTableSheetId(input.sheet);
      const known = new Set(listTableColumns(sheet).map((c) => c.key));
      const missing = input.columns.filter((c) => !known.has(c));
      if (missing.length) {
        return {
          ok: false as const,
          error: `sheet '${sheet}' 没有这些列: ${missing.join(', ')}. 可用列: ${[...known].join(', ')}`,
        };
      }
      emitTableChart({
        type: 'chart',
        sheet,
        columns: input.columns,
        chartType: input.chart_type ?? 'column',
        aggFunc: input.agg_func,
      });
      return { ok: true as const, sheet, columns: input.columns, chart: input.chart_type ?? 'column' };
    },
  });

  const loadCompassOrders = createTool({
    id: 'load_compass_orders',
    description:
      '从 Compass 拉取本租户的订单总览（每订单一行：产品/分厂/工序数/排产状态/计划完工/交期），' +
      '写入名为 orders 的表 sheet。展开一行 = 该订单的完整三级工艺路线。需要 Compass MCP 已连接。',
    inputSchema: z.object({}),
    execute: async () => importCompassOrderSheet(getMcpToolsets),
  });

  const loadCompassResources = createTool({
    id: 'load_compass_resources',
    description:
      '从 Compass 拉取本租户的资源负荷台账（每资源：当前K/建议K/负荷 + 未来12个月负荷趋势），' +
      '写入名为 resources 的表 sheet 供展示（趋势列为迷你图）。需要 Compass MCP 服务器已连接。',
    inputSchema: z.object({}),
    execute: async () => importCompassResourceSheet(getMcpToolsets),
  });

  return {
    table_get: tableGet,
    table_update_row: tableUpdateRow,
    table_set_cell: tableSetCell,
    table_add_row: tableAddRow,
    table_delete_rows: tableDeleteRows,
    table_add_column: tableAddColumn,
    table_delete_column: tableDeleteColumn,
    table_create_sheet: tableCreateSheet,
    table_delete_sheet: tableDeleteSheet,
    table_list_sheets: tableListSheets,
    load_compass_schedule: loadCompassSchedule,
    load_compass_orders: loadCompassOrders,
    load_compass_resources: loadCompassResources,
    table_chart: tableChart,
  };
}
