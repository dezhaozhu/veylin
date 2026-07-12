import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TABLE_AGGREGATE_OPS, TABLE_FILTER_OPS } from '@veylin/shared';
import {
  addTableColumn,
  addTableRow,
  createTableSheet,
  DEFAULT_TABLE_GET_LIMIT,
  deleteTableColumn,
  deleteTableRows,
  deleteTableSheet,
  isTableSheetNameTaken,
  listTableSheets,
  MAX_TABLE_GET_LIMIT,
  queryTableRows,
  renameTableSheet,
  sheetBelongsToThread,
  tryResolveTableSheetId,
  updateTableRow,
  type DeletedTableRowSnapshot,
  type RejectedPatchField,
  type TableRowData,
  type TableRowPatch,
} from './table-store';

const rowSchema = z.record(z.string(), z.union([z.string(), z.number()]));
const cellValueSchema = z.union([z.string(), z.number()]);

type ToolRequestCtx = { requestContext?: { get(key: string): unknown } };

function toolThreadId(ctx?: ToolRequestCtx): string | null {
  return (ctx?.requestContext?.get('threadId') as string | undefined)?.trim() || null;
}

/** Hard cap so one tool call cannot rewrite an entire sheet. */
export const MAX_TABLE_CELL_UPDATES = 20;
export const MAX_TABLE_ADD_ROWS = 20;
export const MAX_TABLE_DELETE_ROWS = 50;
export const MAX_TABLE_ADD_COLUMNS = 10;
export const MAX_TABLE_DELETE_COLUMNS = 10;

function formatRejected(rejected: RejectedPatchField[]): string {
  return rejected.map((r) => r.reason).join('; ');
}

function resolveWriteSheet(
  sheet: string | undefined,
  threadId?: string | null,
): { ok: true; sheet: string } | { ok: false; sheet: string; message: string } {
  if (sheet !== undefined && sheet !== '') {
    const id = tryResolveTableSheetId(sheet);
    if (!id) {
      return {
        ok: false,
        sheet,
        message: `Sheet "${sheet}" not found. Call table_sheets with action "list" for valid ids.`,
      };
    }
    if (threadId && !sheetBelongsToThread(id, threadId)) {
      return {
        ok: false,
        sheet,
        message: `Sheet "${sheet}" not found in this session. Call table_sheets with action "list".`,
      };
    }
    return { ok: true, sheet: id };
  }
  const id = tryResolveTableSheetId(undefined);
  if (!id) {
    return { ok: false, sheet: 'main', message: 'No table sheet available' };
  }
  if (threadId && !sheetBelongsToThread(id, threadId)) {
    return {
      ok: false,
      sheet: id,
      message: 'Default sheet is not available in this session. Create one via table_sheets.',
    };
  }
  return { ok: true, sheet: id };
}

export type TableCellUpdateItem = {
  row_key: string;
  column: string;
  value: string | number;
};

export type TableCellChange = {
  row_key: string;
  column: string;
  value: string | number;
  previous: string | number;
};

/**
 * Apply up to MAX_TABLE_CELL_UPDATES cell writes, aggregating patches per row.
 */
export async function applyTableCellUpdates(
  sheet: string,
  updates: TableCellUpdateItem[],
): Promise<{
  ok: boolean;
  sheet: string;
  updated: number;
  cells: TableCellChange[];
  rejected: RejectedPatchField[];
  message: string;
}> {
  if (updates.length === 0) {
    return {
      ok: false,
      sheet,
      updated: 0,
      cells: [],
      rejected: [],
      message: 'updates must contain at least one cell',
    };
  }
  if (updates.length > MAX_TABLE_CELL_UPDATES) {
    return {
      ok: false,
      sheet,
      updated: 0,
      cells: [],
      rejected: [],
      message:
        `Too many cell updates (${updates.length}). Max ${MAX_TABLE_CELL_UPDATES} per call — split into multiple table_update_cells calls.`,
    };
  }

  // Aggregate by row so one row with N columns is a single store write.
  const byRow = new Map<string, TableRowPatch>();
  for (const item of updates) {
    const patch = byRow.get(item.row_key) ?? {};
    patch[item.column] = item.value;
    byRow.set(item.row_key, patch);
  }

  const cells: TableCellChange[] = [];
  const rejected: RejectedPatchField[] = [];
  let anyOk = false;
  let lastMessage = '';

  for (const [rowKey, patch] of byRow) {
    const result = await updateTableRow(rowKey, patch, sheet);
    if (!result.ok) {
      rejected.push(
        ...result.rejected,
        ...(result.rejected.length === 0
          ? [{ field: rowKey, reason: result.message }]
          : []),
      );
      lastMessage = result.message;
      continue;
    }
    anyOk = true;
    for (const [colKey, value] of Object.entries(result.applied)) {
      cells.push({
        row_key: rowKey,
        column: colKey,
        value,
        previous: result.previous[colKey] ?? '',
      });
    }
    if (result.rejected.length > 0) {
      rejected.push(...result.rejected);
    }
  }

  if (!anyOk) {
    return {
      ok: false,
      sheet,
      updated: 0,
      cells: [],
      rejected,
      message: lastMessage || formatRejected(rejected) || 'No cells updated',
    };
  }

  const rejectMsg = rejected.length ? ` Rejected: ${formatRejected(rejected)}` : '';
  return {
    ok: true,
    sheet,
    updated: cells.length,
    cells,
    rejected,
    message: `Updated ${cells.length} cell(s).${rejectMsg}`,
  };
}

type StructureOp =
  | { op: 'add_rows'; count: number }
  | { op: 'delete_rows'; row_keys: string[] }
  | { op: 'add_columns'; names: string[] }
  | { op: 'delete_columns'; columns: string[] };

export type StructureOpResult =
  | {
      op: 'add_rows';
      ok: boolean;
      row_keys: string[];
      rows: TableRowData[];
      message: string;
    }
  | {
      op: 'delete_rows';
      ok: boolean;
      removed: number;
      rows: DeletedTableRowSnapshot[];
      message: string;
    }
  | {
      op: 'add_columns';
      ok: boolean;
      columns: Array<{ key: string; name: string }>;
      message: string;
    }
  | {
      op: 'delete_columns';
      ok: boolean;
      deleted: string[];
      message: string;
    };

export function applyTableStructureOps(
  sheet: string,
  ops: StructureOp[],
): {
  ok: boolean;
  sheet: string;
  results: StructureOpResult[];
  message: string;
} {
  const results: StructureOpResult[] = [];

  for (const op of ops) {
    if (op.op === 'add_rows') {
      const count = op.count;
      if (count < 1 || count > MAX_TABLE_ADD_ROWS) {
        results.push({
          op: 'add_rows',
          ok: false,
          row_keys: [],
          rows: [],
          message: `add_rows count must be 1–${MAX_TABLE_ADD_ROWS}`,
        });
        continue;
      }
      const rows: TableRowData[] = [];
      for (let i = 0; i < count; i++) {
        const row = addTableRow(sheet);
        if (!row) break;
        rows.push(row);
      }
      results.push({
        op: 'add_rows',
        ok: rows.length === count,
        row_keys: rows.map((r) => r.row_id),
        rows,
        message:
          rows.length === count
            ? `Added ${rows.length} row(s)`
            : `Added ${rows.length}/${count} row(s)`,
      });
      continue;
    }

    if (op.op === 'delete_rows') {
      if (op.row_keys.length < 1 || op.row_keys.length > MAX_TABLE_DELETE_ROWS) {
        results.push({
          op: 'delete_rows',
          ok: false,
          removed: 0,
          rows: [],
          message: `delete_rows requires 1–${MAX_TABLE_DELETE_ROWS} row_keys`,
        });
        continue;
      }
      const { removed, rows } = deleteTableRows(sheet, op.row_keys);
      results.push({
        op: 'delete_rows',
        ok: removed > 0,
        removed,
        rows,
        message: `Deleted ${removed} row(s)`,
      });
      continue;
    }

    if (op.op === 'add_columns') {
      if (op.names.length < 1 || op.names.length > MAX_TABLE_ADD_COLUMNS) {
        results.push({
          op: 'add_columns',
          ok: false,
          columns: [],
          message: `add_columns requires 1–${MAX_TABLE_ADD_COLUMNS} names`,
        });
        continue;
      }
      const columns: Array<{ key: string; name: string }> = [];
      let failedName: string | null = null;
      for (const name of op.names) {
        const col = addTableColumn(sheet, name);
        if (!col) {
          failedName = name;
          break;
        }
        columns.push({ key: col.key, name: col.name });
      }
      results.push({
        op: 'add_columns',
        ok: failedName == null && columns.length === op.names.length,
        columns,
        message:
          failedName == null
            ? `Added ${columns.length} column(s)`
            : `Added ${columns.length}/${op.names.length} column(s); failed at "${failedName}"`,
      });
      continue;
    }

    if (op.op === 'delete_columns') {
      if (op.columns.length < 1 || op.columns.length > MAX_TABLE_DELETE_COLUMNS) {
        results.push({
          op: 'delete_columns',
          ok: false,
          deleted: [],
          message: `delete_columns requires 1–${MAX_TABLE_DELETE_COLUMNS} columns`,
        });
        continue;
      }
      const deleted: string[] = [];
      for (const column of op.columns) {
        if (deleteTableColumn(sheet, column)) deleted.push(column);
      }
      results.push({
        op: 'delete_columns',
        ok: deleted.length === op.columns.length,
        deleted,
        message:
          deleted.length === op.columns.length
            ? `Deleted ${deleted.length} column(s)`
            : `Deleted ${deleted.length}/${op.columns.length} column(s)`,
      });
    }
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  const summary = results.map((r) => r.message).join('; ') || 'No ops';
  return { ok, sheet, results, message: summary };
}

/**
 * Generic spreadsheet/table tools backed by the multi-sheet grid store.
 * Exposed surface: table_get, table_sheets, table_update_cells, table_edit_structure.
 */
export function buildTableTools() {
  const filterSchema = z.object({
    column: z.string().describe('Column key or display name.'),
    op: z.enum(TABLE_FILTER_OPS).describe(
      'eq|neq|contains|gt|gte|lt|lte|empty|not_empty',
    ),
    value: cellValueSchema.optional().describe('Compare value (omit for empty/not_empty).'),
  });

  const aggregateMetricSchema = z.object({
    op: z.enum(TABLE_AGGREGATE_OPS).describe('count|sum|avg|min|max'),
    column: z
      .string()
      .optional()
      .describe('Column for sum/avg/min/max (or non-empty count). Omit for row count.'),
  });

  const tableGet = createTool({
    id: 'table_get',
    description:
      'Read or query a table sheet (same data as the right-panel 表格). ' +
      'Everyday: use query (search box) and/or top-level sort_by+sort_dir (column header sort), then paginate with offset/limit. ' +
      'Advanced: filters (column operators), columns (projection), row_keys (exact rows), ' +
      'aggregate (count/sum/avg/min/max + optional group_by). ' +
      'For TOP-N groups: aggregate + top-level sort_by=count (or sum_*) + sort_dir=desc + limit (default 50, max 200). ' +
      'sort_by/sort_dir belong at the top level (also accepted inside aggregate as a compatibility alias). ' +
      'Do not request all groups of a high-cardinality column — page with offset when hasMore. ' +
      'Pipeline: row_keys → query → filters → row sort → aggregate → group sort → offset/limit. ' +
      'Call table_sheets action "list" if sheet id is unknown.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      query: z
        .string()
        .optional()
        .describe('Full-text search across all columns (same as the table search box).'),
      sort_by: z
        .string()
        .optional()
        .describe(
          'Top-level sort key: column name for rows, or aggregate metric key (e.g. count, sum_qty) after group_by.',
        ),
      sort_dir: z
        .enum(['asc', 'desc'])
        .optional()
        .describe('Top-level sort direction (default asc when sort_by is set).'),
      filters: z
        .array(filterSchema)
        .optional()
        .describe('AND column filters with operators.'),
      columns: z
        .array(z.string())
        .optional()
        .describe('Optional column projection for row mode (keys or names). row_id always included.'),
      row_keys: z
        .array(z.string())
        .optional()
        .describe('If set, start from these row_id values only.'),
      aggregate: z
        .object({
          metrics: z.array(aggregateMetricSchema).min(1),
          group_by: z.string().optional().describe('Optional group-by column key or name.'),
          sort_by: z
            .string()
            .optional()
            .describe('Compatibility alias for top-level sort_by (top-level wins if both set).'),
          sort_dir: z
            .enum(['asc', 'desc'])
            .optional()
            .describe('Compatibility alias for top-level sort_dir (top-level wins if both set).'),
        })
        .optional()
        .describe('When set, return aggregate groups (paginated) instead of row pages.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Offset for rows or aggregate groups (default 0).'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_TABLE_GET_LIMIT)
        .optional()
        .describe(
          `Page size for rows or aggregate groups (default ${DEFAULT_TABLE_GET_LIMIT}, max ${MAX_TABLE_GET_LIMIT}).`,
        ),
    }),
    outputSchema: z.object({
      sheet: z.string(),
      totalRows: z.number(),
      matchedRows: z.number(),
      matchedGroups: z.number().optional(),
      mode: z.enum(['rows', 'aggregate']),
      offset: z.number().optional(),
      limit: z.number().optional(),
      hasMore: z.boolean().optional(),
      columns: z.array(
        z.object({ key: z.string(), name: z.string(), type: z.string() }),
      ),
      rows: z.array(rowSchema).optional(),
      group_by: z.string().optional(),
      groups: z
        .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
        .optional(),
      notice: z.string().optional(),
    }),
    execute: async (input, ctx?: ToolRequestCtx) => {
      const threadId = toolThreadId(ctx);
      const resolved = resolveWriteSheet(input.sheet, threadId);
      if (!resolved.ok) {
        return {
          sheet: resolved.sheet,
          totalRows: 0,
          matchedRows: 0,
          mode: 'rows' as const,
          columns: [],
          rows: [],
          notice: resolved.message,
        };
      }
      const sheet = resolved.sheet;
      const nestedSortBy = input.aggregate?.sort_by;
      const nestedSortDir = input.aggregate?.sort_dir;
      const sortBy = input.sort_by ?? nestedSortBy;
      const sortDir = input.sort_dir ?? nestedSortDir;
      const usedNestedSortAlias =
        Boolean(input.aggregate) &&
        ((nestedSortBy != null && input.sort_by == null) ||
          (nestedSortDir != null && input.sort_dir == null));

      const result = queryTableRows(sheet, {
        query: input.query,
        sortBy,
        sortDir,
        filters: input.filters,
        columns: input.columns,
        rowKeys: input.row_keys,
        aggregate: input.aggregate
          ? {
              metrics: input.aggregate.metrics,
              groupBy: input.aggregate.group_by,
            }
          : undefined,
        offset: input.offset,
        limit: input.limit,
      });

      const nestedSortNotice = usedNestedSortAlias
        ? 'sort_by was read from aggregate; prefer top-level sort_by next time.'
        : undefined;

      if (result.mode === 'aggregate') {
        const hasMore = result.hasMore;
        const baseNotice =
          result.matchedRows === 0
            ? 'No rows matched the query/filters; aggregates are empty or zero.'
            : hasMore
              ? `Showing ${result.groups.length} of ${result.matchedGroups} group(s) ` +
                `(${result.matchedRows} matched row(s)). ` +
                `Call table_get again with offset=${result.offset + result.groups.length} for more groups.`
              : undefined;
        const notice = [nestedSortNotice, baseNotice].filter(Boolean).join(' ') || undefined;
        return {
          sheet,
          totalRows: result.totalRows,
          matchedRows: result.matchedRows,
          matchedGroups: result.matchedGroups,
          mode: 'aggregate' as const,
          offset: result.offset,
          limit: result.limit,
          hasMore,
          columns: [],
          group_by: result.groupBy,
          groups: result.groups,
          ...(notice ? { notice } : {}),
        };
      }

      const hasMore = result.hasMore;
      const baseNotice = hasMore
        ? `Showing ${result.rows.length} of ${result.matchedRows} matched row(s) ` +
          `(sheet has ${result.totalRows} total). ` +
          `Call table_get again with offset=${result.offset + result.rows.length} for the next page.`
        : result.totalRows === 0
          ? 'This sheet has zero rows in the server table store. ' +
            'If the UI shows data, confirm the correct sheet id via table_sheets action "list".'
          : result.matchedRows === 0
            ? 'No rows matched query/filters. Broaden search or clear filters.'
            : undefined;
      // nested sort alias only applies with aggregate; keep rows path unchanged beyond that
      return {
        sheet,
        totalRows: result.totalRows,
        matchedRows: result.matchedRows,
        mode: 'rows' as const,
        offset: result.offset,
        limit: result.limit,
        hasMore,
        columns: result.columns,
        rows: result.rows,
        ...(baseNotice ? { notice: baseNotice } : {}),
      };
    },
  });

  const cellUpdateSchema = z.object({
    row_key: z.string().describe('row_id from table_get or table_edit_structure add_rows.'),
    column: z.string().describe('Column key or display name.'),
    value: cellValueSchema.describe('New cell value.'),
  });

  const tableUpdateCells = createTool({
    id: 'table_update_cells',
    description:
      `Update multiple cells in one call (max ${MAX_TABLE_CELL_UPDATES}). ` +
      'Prefer small batches; split large edits across multiple calls. ' +
      "Column may be key or display name. Status columns only accept values in that column's statusOptions.",
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      updates: z
        .array(cellUpdateSchema)
        .min(1)
        .max(MAX_TABLE_CELL_UPDATES)
        .describe(`Cells to write (1–${MAX_TABLE_CELL_UPDATES}).`),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      updated: z.number(),
      cells: z.array(
        z.object({
          row_key: z.string(),
          column: z.string(),
          value: cellValueSchema,
          previous: cellValueSchema,
        }),
      ),
      rejected: z
        .array(z.object({ field: z.string(), reason: z.string() }))
        .optional(),
      message: z.string(),
    }),
    execute: async (input, ctx?: ToolRequestCtx) => {
      const resolved = resolveWriteSheet(input.sheet, toolThreadId(ctx));
      if (!resolved.ok) {
        return {
          ok: false,
          sheet: resolved.sheet,
          updated: 0,
          cells: [],
          message: resolved.message,
        };
      }
      const result = await applyTableCellUpdates(resolved.sheet, input.updates);
      return {
        ok: result.ok,
        sheet: result.sheet,
        updated: result.updated,
        cells: result.cells,
        rejected: result.rejected.length > 0 ? result.rejected : undefined,
        message: result.message,
      };
    },
  });

  const structureOpSchema = z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add_rows'),
      count: z
        .number()
        .int()
        .min(1)
        .max(MAX_TABLE_ADD_ROWS)
        .describe(`Number of blank rows to append (1–${MAX_TABLE_ADD_ROWS}).`),
    }),
    z.object({
      op: z.literal('delete_rows'),
      row_keys: z
        .array(z.string())
        .min(1)
        .max(MAX_TABLE_DELETE_ROWS)
        .describe(`row_id values to delete (1–${MAX_TABLE_DELETE_ROWS}).`),
    }),
    z.object({
      op: z.literal('add_columns'),
      names: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_TABLE_ADD_COLUMNS)
        .describe(`New column display names (1–${MAX_TABLE_ADD_COLUMNS}).`),
    }),
    z.object({
      op: z.literal('delete_columns'),
      columns: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_TABLE_DELETE_COLUMNS)
        .describe(`Column keys to delete (1–${MAX_TABLE_DELETE_COLUMNS}).`),
    }),
  ]);

  const tableEditStructure = createTool({
    id: 'table_edit_structure',
    description:
      'Batch add/delete rows and columns on a sheet. ' +
      'Use add_rows then table_update_cells to fill values. ' +
      'Ops run in order; check each result for partial failures.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      ops: z.array(structureOpSchema).min(1).describe('Structure operations in order.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      results: z.array(
        z.object({
          op: z.enum(['add_rows', 'delete_rows', 'add_columns', 'delete_columns']),
          ok: z.boolean(),
          message: z.string(),
          row_keys: z.array(z.string()).optional(),
          rows: z.array(z.unknown()).optional(),
          removed: z.number().optional(),
          columns: z
            .array(z.object({ key: z.string(), name: z.string() }))
            .optional(),
          deleted: z.array(z.string()).optional(),
        }),
      ),
      message: z.string(),
    }),
    execute: async (input, ctx?: ToolRequestCtx) => {
      const resolved = resolveWriteSheet(input.sheet, toolThreadId(ctx));
      if (!resolved.ok) {
        return {
          ok: false,
          sheet: resolved.sheet,
          results: [],
          message: resolved.message,
        };
      }
      return applyTableStructureOps(resolved.sheet, input.ops);
    },
  });

  const tableSheets = createTool({
    id: 'table_sheets',
    description:
      'Manage table sheets (tabs): list, create, rename, or delete. ' +
      'Sheet display names must be unique (case-insensitive). ' +
      'Use action "list" when sheet id is unknown before table_get / writes.',
    inputSchema: z.object({
      action: z
        .enum(['list', 'create', 'rename', 'delete'])
        .describe('Sheet action.'),
      name: z
        .string()
        .optional()
        .describe('Unique sheet display name (required for create/rename).'),
      sheet: z
        .string()
        .optional()
        .describe('Sheet id (required for rename/delete).'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      action: z.enum(['list', 'create', 'rename', 'delete']),
      sheets: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            builtin: z.boolean(),
          }),
        )
        .optional(),
      sheet: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
      message: z.string(),
    }),
    execute: async (input, ctx?: ToolRequestCtx) => {
      const threadId = toolThreadId(ctx);
      if (input.action === 'list') {
        const sheets = listTableSheets(threadId);
        return {
          ok: true,
          action: 'list' as const,
          sheets,
          message: `Listed ${sheets.length} sheet(s)`,
        };
      }
      if (input.action === 'create') {
        const name = input.name?.trim();
        if (!name) {
          return {
            ok: false,
            action: 'create' as const,
            sheet: null,
            message: 'name is required for create',
          };
        }
        if (!threadId) {
          return {
            ok: false,
            action: 'create' as const,
            sheet: null,
            message: 'threadId required to create a session-scoped sheet',
          };
        }
        if (isTableSheetNameTaken(name, undefined, threadId)) {
          return {
            ok: false,
            action: 'create' as const,
            sheet: null,
            sheets: listTableSheets(threadId),
            message: `Sheet name "${name}" already exists. Sheet names must be unique.`,
          };
        }
        const sheet = createTableSheet(name, threadId);
        if (!sheet) {
          return {
            ok: false,
            action: 'create' as const,
            sheet: null,
            message: 'Failed to create sheet',
          };
        }
        return {
          ok: true,
          action: 'create' as const,
          sheet: { id: sheet.id, name: sheet.name },
          message: `Created sheet ${sheet.name}`,
        };
      }
      if (input.action === 'rename') {
        const sheetId = input.sheet?.trim();
        const name = input.name?.trim();
        if (!sheetId) {
          return {
            ok: false,
            action: 'rename' as const,
            sheet: null,
            message: 'sheet id is required for rename',
          };
        }
        if (!name) {
          return {
            ok: false,
            action: 'rename' as const,
            sheet: null,
            message: 'name is required for rename',
          };
        }
        const existing = listTableSheets().find((s) => s.id === sheetId);
        if (!existing || (threadId && (existing.threadId ?? '') !== threadId)) {
          return {
            ok: false,
            action: 'rename' as const,
            sheet: null,
            message: 'sheet not found in this session',
          };
        }
        if (isTableSheetNameTaken(name, sheetId, existing.threadId ?? threadId)) {
          return {
            ok: false,
            action: 'rename' as const,
            sheet: null,
            sheets: listTableSheets(threadId),
            message: `Sheet name "${name}" already exists. Sheet names must be unique.`,
          };
        }
        const sheet = renameTableSheet(sheetId, name);
        if (!sheet) {
          return {
            ok: false,
            action: 'rename' as const,
            sheet: null,
            message: 'Failed to rename sheet',
          };
        }
        return {
          ok: true,
          action: 'rename' as const,
          sheet: { id: sheet.id, name: sheet.name },
          sheets: listTableSheets(threadId),
          message: `Renamed sheet to ${sheet.name}`,
        };
      }
      // delete
      const sheetId = input.sheet?.trim();
      if (!sheetId) {
        return {
          ok: false,
          action: 'delete' as const,
          message: 'sheet id is required for delete',
        };
      }
      const target = listTableSheets().find((s) => s.id === sheetId);
      if (threadId && target && (target.threadId ?? '') !== threadId) {
        return {
          ok: false,
          action: 'delete' as const,
          message: 'sheet not found in this session',
        };
      }
      const ok = await deleteTableSheet(sheetId);
      return {
        ok,
        action: 'delete' as const,
        message: ok ? `Deleted sheet ${sheetId}` : 'Failed to delete sheet',
      };
    },
  });

  return {
    table_get: tableGet,
    table_update_cells: tableUpdateCells,
    table_edit_structure: tableEditStructure,
    table_sheets: tableSheets,
  };
}
