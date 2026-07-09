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
  listTableColumns,
  listTableRowsPage,
  listTableSheets,
  MAX_TABLE_GET_LIMIT,
  resolveTableSheetId,
  tryResolveTableSheetId,
  updateTableRow,
  type RejectedPatchField,
} from './table-store';

const rowSchema = z.record(z.string(), z.union([z.string(), z.number()]));
const cellValueSchema = z.union([z.string(), z.number()]);

function formatRejected(rejected: RejectedPatchField[]): string {
  return rejected.map((r) => r.reason).join('; ');
}

function resolveWriteSheet(
  sheet: string | undefined,
): { ok: true; sheet: string } | { ok: false; sheet: string; message: string } {
  if (sheet !== undefined && sheet !== '') {
    const id = tryResolveTableSheetId(sheet);
    if (!id) {
      return {
        ok: false,
        sheet,
        message: `Sheet "${sheet}" not found. Call table_list_sheets for valid ids.`,
      };
    }
    return { ok: true, sheet: id };
  }
  const id = tryResolveTableSheetId(undefined);
  if (!id) {
    return { ok: false, sheet: 'main', message: 'No table sheet available' };
  }
  return { ok: true, sheet: id };
}

/**
 * Generic spreadsheet/table tools backed by the multi-sheet grid store.
 */
export function buildTableTools() {
  const tableGet = createTool({
    id: 'table_get',
    description:
      'Read rows and column definitions from a table sheet (paginated). ' +
      'Always check totalRows in the response; call again with offset/limit for more. ' +
      'Call table_list_sheets first if sheet id is unknown.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(`Row offset for pagination (default 0).`),
      limit: z
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
      const offset = input.offset ?? 0;
      const limit = input.limit ?? DEFAULT_TABLE_GET_LIMIT;
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
      'Update multiple cells on one row. Identify the row with row_key (row_id from table_get). ' +
      "Column keys may be column key or display name. Status columns only accept values listed in that column's statusOptions.",
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z.string().describe('row_id from table_get.'),
      values: rowSchema.describe('Column key or name → new value. Only include columns to change.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      applied: rowSchema.optional(),
      previous: rowSchema.optional(),
      message: z.string(),
    }),
    execute: async (input) => {
      const resolved = resolveWriteSheet(input.sheet);
      if (!resolved.ok) {
        return { ok: false, sheet: resolved.sheet, row: null, message: resolved.message };
      }
      const result = await updateTableRow(input.row_key, input.values, resolved.sheet);
      if (!result.ok) {
        return {
          ok: false,
          sheet: result.sheet,
          row: result.row,
          applied: result.applied,
          previous: result.previous,
          message: result.message,
        };
      }
      const rejectMsg = result.rejected.length
        ? ` Rejected: ${formatRejected(result.rejected)}`
        : '';
      return {
        ok: true,
        sheet: result.sheet,
        row: result.row,
        applied: result.applied,
        previous: result.previous,
        message: `Updated row ${input.row_key}.${rejectMsg}`,
      };
    },
  });

  const tableSetCell = createTool({
    id: 'table_set_cell',
    description:
      'Write a single cell. Use row_key = row_id from table_get; column may be column key or display name. ' +
      "Status columns only accept values in that column's statusOptions (see table_get columns).",
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z.string().describe('row_id from table_get.'),
      column: z.string().describe('Column key or display name to write.'),
      value: cellValueSchema.describe('New cell value.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: rowSchema.nullable(),
      applied: rowSchema.optional(),
      previous: rowSchema.optional(),
      message: z.string(),
    }),
    execute: async (input) => {
      const resolved = resolveWriteSheet(input.sheet);
      if (!resolved.ok) {
        return { ok: false, sheet: resolved.sheet, row: null, message: resolved.message };
      }
      const result = await updateTableRow(
        input.row_key,
        { [input.column]: input.value },
        resolved.sheet,
      );
      if (!result.ok) {
        return {
          ok: false,
          sheet: result.sheet,
          row: result.row,
          applied: result.applied,
          previous: result.previous,
          message: result.message,
        };
      }
      if (result.rejected.length > 0) {
        return {
          ok: false,
          sheet: result.sheet,
          row: result.row,
          applied: result.applied,
          previous: result.previous,
          message: formatRejected(result.rejected),
        };
      }
      return {
        ok: true,
        sheet: result.sheet,
        row: result.row,
        applied: result.applied,
        previous: result.previous,
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
      const resolved = resolveWriteSheet(input.sheet);
      if (!resolved.ok) {
        return { ok: false, sheet: resolved.sheet, row: null, message: resolved.message };
      }
      const row = addTableRow(resolved.sheet);
      if (!row) return { ok: false, sheet: resolved.sheet, row: null, message: 'Failed to add row' };
      return { ok: true, sheet: resolved.sheet, row, message: 'Added a blank row' };
    },
  });

  const tableDeleteRows = createTool({
    id: 'table_delete_rows',
    description: 'Delete rows by row_key values.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_keys: z.array(z.string()).min(1).describe('row_id values to delete.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      removed: z.number(),
      message: z.string(),
    }),
    execute: async (input) => {
      const resolved = resolveWriteSheet(input.sheet);
      if (!resolved.ok) {
        return { ok: false, sheet: resolved.sheet, removed: 0, message: resolved.message };
      }
      const removed = deleteTableRows(resolved.sheet, input.row_keys);
      return {
        ok: removed > 0,
        sheet: resolved.sheet,
        removed,
        message: `Deleted ${removed} row(s)`,
      };
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
      const resolved = resolveWriteSheet(input.sheet);
      if (!resolved.ok) {
        return { ok: false, sheet: resolved.sheet, column: null, message: resolved.message };
      }
      const column = addTableColumn(resolved.sheet, input.name);
      if (!column) {
        return { ok: false, sheet: resolved.sheet, column: null, message: 'Failed to add column' };
      }
      return {
        ok: true,
        sheet: resolved.sheet,
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
      const resolved = resolveWriteSheet(input.sheet);
      if (!resolved.ok) {
        return { ok: false, sheet: resolved.sheet, message: resolved.message };
      }
      const ok = deleteTableColumn(resolved.sheet, input.column);
      return {
        ok,
        sheet: resolved.sheet,
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
      return {
        ok: true,
        sheet: { id: sheet.id, name: sheet.name },
        message: `Created sheet ${sheet.name}`,
      };
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
  };
}
