import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  addScheduleColumn,
  addScheduleRow,
  createScheduleSheet,
  deleteScheduleColumn,
  deleteScheduleRows,
  deleteScheduleSheet,
  listSchedule,
  listScheduleColumns,
  listScheduleSheets,
  resolveScheduleSheetId,
  updateScheduleRow,
} from './schedule-store';

const scheduleRowSchema = z.record(z.string(), z.union([z.string(), z.number()]));
const cellValueSchema = z.union([z.string(), z.number()]);

/** Mark a tool as approval-gated. Toolset tools bypass the policy wrapper in
 *  agents.ts, so the flag must live on the tool object itself. */
function withApproval<T>(tool: T): T {
  (tool as { requireApproval?: boolean }).requireApproval = true;
  return tool;
}

/**
 * Agent-callable tools for reading and mutating the production schedule grid.
 * Covers cell writes plus row / column / sheet create + delete.
 */
export function buildScheduleTools() {
  const getSchedule = createTool({
    id: 'schedule_get',
    description:
      'Read production schedule rows from a sheet. Use schedule_get after listing ' +
      'sheet ids from the user context. Columns vary per sheet; rows include order_no ' +
      'and (for newly added rows) a row_id used to address blank rows.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
    }),
    outputSchema: z.object({
      sheet: z.string(),
      columns: z.array(
        z.object({ key: z.string(), name: z.string(), type: z.string() }),
      ),
      rows: z.array(scheduleRowSchema),
    }),
    execute: async (input) => {
      const sheet = resolveScheduleSheetId(input.sheet);
      return {
        sheet,
        columns: listScheduleColumns(sheet).map((c) => ({
          key: c.key,
          name: c.name,
          type: c.type,
        })),
        rows: listSchedule(sheet),
      };
    },
  });

  const updateSchedule = createTool({
    id: 'schedule_update',
    description:
      'Update one production schedule row in a sheet, matched by order_no. ' +
      'Provide only the fields to change. To address a blank/new row, use schedule_set_cell with row_key.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      order_no: z.string().describe('Work order number identifying the row, e.g. WO-1003'),
      product: z.string().optional(),
      qty: z.number().optional(),
      planned_start: z.string().optional(),
      planned_end: z.string().optional(),
      resource: z.string().optional(),
      status: z.enum(['normal', 'tight', 'overdue']).optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: scheduleRowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveScheduleSheetId(input.sheet);
      const { order_no, sheet: _s, ...patch } = input;
      const updated = await updateScheduleRow(order_no, patch, sheet);
      if (!updated) {
        return { ok: false, sheet, row: null, message: `Work order ${order_no} not found` };
      }
      return { ok: true, sheet, row: updated, message: `Updated work order ${order_no}` };
    },
  });

  const setCell = createTool({
    id: 'schedule_set_cell',
    description:
      'Write a single cell. Identify the row by row_key (row_id for blank/new rows) ' +
      'or by order_no (for seeded rows). column is a column key from schedule_get.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
      row_key: z
        .string()
        .optional()
        .describe('Row id (preferred). Use for blank rows added via schedule_add_row.'),
      order_no: z.string().optional().describe('Work order number, alternative to row_key.'),
      column: z.string().describe('Column key to write, e.g. product / qty / status.'),
      value: cellValueSchema.describe('New cell value.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: scheduleRowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveScheduleSheetId(input.sheet);
      const key = input.row_key ?? input.order_no;
      if (!key) {
        return { ok: false, sheet, row: null, message: 'row_key or order_no is required' };
      }
      const updated = await updateScheduleRow(key, { [input.column]: input.value }, sheet);
      if (!updated) {
        return { ok: false, sheet, row: null, message: `Row ${key} not found` };
      }
      return { ok: true, sheet, row: updated, message: `Updated ${key}.${input.column}` };
    },
  });

  const addRow = createTool({
    id: 'schedule_add_row',
    description:
      'Append a blank row to a sheet. Returns the new row including its row_id, ' +
      'which you can pass to schedule_set_cell to fill cells.',
    inputSchema: z.object({
      sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.string(),
      row: scheduleRowSchema.nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = resolveScheduleSheetId(input.sheet);
      const row = addScheduleRow(sheet);
      if (!row) return { ok: false, sheet, row: null, message: 'Failed to add row' };
      return { ok: true, sheet, row, message: 'Added a blank row' };
    },
  });

  const deleteRows = withApproval(
    createTool({
      id: 'schedule_delete_rows',
      description: 'Delete rows from a sheet by their row keys (row_id or order_no).',
      inputSchema: z.object({
        sheet: z.string().optional().describe('Sheet id. Defaults to main.'),
        row_keys: z.array(z.string()).min(1).describe('Row ids or order_nos to delete.'),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        sheet: z.string(),
        removed: z.number(),
        message: z.string(),
      }),
      execute: async (input) => {
        const sheet = resolveScheduleSheetId(input.sheet);
        const removed = deleteScheduleRows(sheet, input.row_keys);
        return { ok: removed > 0, sheet, removed, message: `Deleted ${removed} row(s)` };
      },
    }),
  );

  const addColumn = createTool({
    id: 'schedule_add_column',
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
      const sheet = resolveScheduleSheetId(input.sheet);
      const column = addScheduleColumn(sheet, input.name);
      if (!column) return { ok: false, sheet, column: null, message: 'Failed to add column' };
      return { ok: true, sheet, column: { key: column.key, name: column.name }, message: `Added column ${column.name}` };
    },
  });

  const deleteColumn = withApproval(
    createTool({
      id: 'schedule_delete_column',
      description: 'Delete a column from a sheet by its column key. Fixed columns cannot be deleted.',
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
        const sheet = resolveScheduleSheetId(input.sheet);
        const ok = deleteScheduleColumn(sheet, input.column);
        return { ok, sheet, message: ok ? `Deleted column ${input.column}` : `Failed to delete column ${input.column}` };
      },
    }),
  );

  const createSheet = createTool({
    id: 'schedule_create_sheet',
    description: 'Create a new schedule sheet (tab) with the default column schema.',
    inputSchema: z.object({
      name: z.string().describe('Sheet display name.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      sheet: z.object({ id: z.string(), name: z.string() }).nullable(),
      message: z.string(),
    }),
    execute: async (input) => {
      const sheet = createScheduleSheet(input.name);
      if (!sheet) return { ok: false, sheet: null, message: 'Failed to create sheet' };
      return { ok: true, sheet: { id: sheet.id, name: sheet.name }, message: `Created sheet ${sheet.name}` };
    },
  });

  const deleteSheet = withApproval(
    createTool({
      id: 'schedule_delete_sheet',
      description: 'Delete a schedule sheet (tab) by id. At least one sheet must remain.',
      inputSchema: z.object({
        sheet: z.string().describe('Sheet id to delete.'),
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        message: z.string(),
      }),
      execute: async (input) => {
        const ok = deleteScheduleSheet(input.sheet);
        return { ok, message: ok ? `Deleted sheet ${input.sheet}` : 'Failed to delete sheet' };
      },
    }),
  );

  const listSheets = createTool({
    id: 'schedule_list_sheets',
    description: 'List available production schedule sheets (tabs).',
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
    execute: async () => ({ sheets: listScheduleSheets() }),
  });

  return {
    schedule_get: getSchedule,
    schedule_update: updateSchedule,
    schedule_set_cell: setCell,
    schedule_add_row: addRow,
    schedule_delete_rows: deleteRows,
    schedule_add_column: addColumn,
    schedule_delete_column: deleteColumn,
    schedule_create_sheet: createSheet,
    schedule_delete_sheet: deleteSheet,
    schedule_list_sheets: listSheets,
  };
}
