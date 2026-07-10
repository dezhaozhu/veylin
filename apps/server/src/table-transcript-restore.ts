/**
 * Undo cell-level table mutations recorded in removed transcript messages
 * (edit truncate / forceReplace), mirroring todos' transcript-authoritative sync.
 */

import type { UiMessage } from '@veylin/shared';
import {
  deleteTableRows,
  restoreDeletedTableRows,
  updateTableRow,
  type DeletedTableRowSnapshot,
  type TableRowData,
  type TableRowPatch,
} from './table-store';

const CELL_MUTATING_TOOLS = new Set([
  // Legacy (historical transcripts)
  'table_set_cell',
  'table_update_row',
  'table_add_row',
  'table_delete_rows',
  // Current tools
  'table_update_cells',
  'table_edit_structure',
]);

export type TableCellMutation =
  | {
      toolName: 'table_set_cell' | 'table_update_row';
      sheet: string;
      rowKey: string;
      previous: TableRowPatch;
    }
  | {
      toolName: 'table_update_cells';
      sheet: string;
      /** Per-row previous patches to restore. */
      rows: Array<{ rowKey: string; previous: TableRowPatch }>;
    }
  | {
      toolName: 'table_add_row';
      sheet: string;
      rowId: string;
    }
  | {
      toolName: 'table_delete_rows';
      sheet: string;
      rows: DeletedTableRowSnapshot[];
    }
  | {
      toolName: 'table_edit_structure';
      sheet: string;
      /** Inverse ops in reverse chronological order (already reversed). */
      inverses: StructureInverse[];
    };

type StructureInverse =
  | { kind: 'delete_added_rows'; rowIds: string[] }
  | { kind: 'restore_deleted_rows'; rows: DeletedTableRowSnapshot[] }
  | { kind: 'skip'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function resultOk(result: unknown): boolean {
  if (result == null) return false;
  if (!isRecord(result)) return true;
  if ('ok' in result) return result.ok === true;
  return true;
}

function readToolName(part: Record<string, unknown>): string | null {
  if (typeof part.toolName === 'string' && part.toolName) return part.toolName;
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const name = part.type.slice('tool-'.length);
    return name || null;
  }
  return null;
}

function readResult(part: Record<string, unknown>): unknown {
  if ('output' in part) return part.output;
  if ('result' in part) return part.result;
  return undefined;
}

function readArgs(part: Record<string, unknown>): unknown {
  if ('input' in part) return part.input;
  if ('args' in part) return part.args;
  return undefined;
}

function readSheet(result: Record<string, unknown>, args: unknown): string {
  if (typeof result.sheet === 'string' && result.sheet) return result.sheet;
  if (isRecord(args) && typeof args.sheet === 'string' && args.sheet) {
    return args.sheet;
  }
  return 'main';
}

function asRowPatch(value: unknown): TableRowPatch | null {
  if (!isRecord(value)) return null;
  const out: TableRowPatch = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'row_id') continue;
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return out;
}

function asRowData(value: unknown): TableRowData | null {
  if (!isRecord(value)) return null;
  if (typeof value.row_id !== 'string' || !value.row_id) return null;
  const out: TableRowData = { row_id: value.row_id };
  for (const [k, v] of Object.entries(value)) {
    if (k === 'row_id') continue;
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return out;
}

function asDeletedSnapshots(value: unknown): DeletedTableRowSnapshot[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: DeletedTableRowSnapshot[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.index !== 'number' || !Number.isFinite(item.index)) continue;
    const row = asRowData(item.row);
    if (!row) continue;
    out.push({ index: item.index, row });
  }
  return out.length > 0 ? out : null;
}

function previousPatchesFromUpdateCells(
  result: Record<string, unknown>,
): Array<{ rowKey: string; previous: TableRowPatch }> | null {
  if (!Array.isArray(result.cells)) return null;
  const byRow = new Map<string, TableRowPatch>();
  for (const cell of result.cells) {
    if (!isRecord(cell)) continue;
    if (typeof cell.row_key !== 'string' || !cell.row_key) continue;
    if (typeof cell.column !== 'string' || !cell.column) continue;
    if (typeof cell.previous !== 'string' && typeof cell.previous !== 'number') continue;
    const patch = byRow.get(cell.row_key) ?? {};
    patch[cell.column] = cell.previous;
    byRow.set(cell.row_key, patch);
  }
  if (byRow.size === 0) return null;
  return Array.from(byRow.entries()).map(([rowKey, previous]) => ({ rowKey, previous }));
}

function structureInversesFromResult(
  result: Record<string, unknown>,
): StructureInverse[] | null {
  if (!Array.isArray(result.results)) return null;
  const inverses: StructureInverse[] = [];
  // Build forward then reverse so undo runs newest-op-first within the call.
  for (const item of result.results) {
    if (!isRecord(item) || item.ok !== true) continue;
    if (item.op === 'add_rows') {
      const keys = Array.isArray(item.row_keys)
        ? item.row_keys.filter((k): k is string => typeof k === 'string' && Boolean(k))
        : Array.isArray(item.rows)
          ? item.rows
              .map((r) => (isRecord(r) && typeof r.row_id === 'string' ? r.row_id : null))
              .filter((k): k is string => Boolean(k))
          : [];
      if (keys.length > 0) inverses.push({ kind: 'delete_added_rows', rowIds: keys });
      continue;
    }
    if (item.op === 'delete_rows') {
      const rows = asDeletedSnapshots(item.rows);
      if (rows) inverses.push({ kind: 'restore_deleted_rows', rows });
      continue;
    }
    if (item.op === 'add_columns' || item.op === 'delete_columns') {
      // Column schema undo is not supported in transcript restore (same as legacy).
      inverses.push({ kind: 'skip', reason: `unsupported inverse for ${String(item.op)}` });
    }
  }
  if (inverses.length === 0) return null;
  return inverses.reverse();
}

function mutationFromPart(part: unknown): TableCellMutation | null {
  if (!isRecord(part)) return null;
  const toolName = readToolName(part);
  if (!toolName || !CELL_MUTATING_TOOLS.has(toolName)) return null;

  const result = readResult(part);
  if (!resultOk(result) || !isRecord(result)) return null;
  const args = readArgs(part);
  const sheet = readSheet(result, args);

  if (toolName === 'table_set_cell' || toolName === 'table_update_row') {
    const previous = asRowPatch(result.previous);
    if (!previous || Object.keys(previous).length === 0) {
      console.warn(
        `[table-restore] skip ${toolName}: missing previous in tool result`,
      );
      return null;
    }
    const rowKey =
      (isRecord(args) && typeof args.row_key === 'string' && args.row_key) ||
      (typeof result.row === 'object' &&
        result.row != null &&
        isRecord(result.row) &&
        typeof result.row.row_id === 'string' &&
        result.row.row_id) ||
      null;
    if (!rowKey) {
      console.warn(`[table-restore] skip ${toolName}: missing row_key`);
      return null;
    }
    return { toolName, sheet, rowKey, previous };
  }

  if (toolName === 'table_update_cells') {
    const rows = previousPatchesFromUpdateCells(result);
    if (!rows) {
      console.warn('[table-restore] skip table_update_cells: missing cells/previous');
      return null;
    }
    return { toolName: 'table_update_cells', sheet, rows };
  }

  if (toolName === 'table_add_row') {
    const row = asRowData(result.row);
    if (!row) {
      console.warn('[table-restore] skip table_add_row: missing row in result');
      return null;
    }
    return { toolName: 'table_add_row', sheet, rowId: row.row_id };
  }

  if (toolName === 'table_delete_rows') {
    const rows = asDeletedSnapshots(result.rows);
    if (!rows) {
      console.warn(
        '[table-restore] skip table_delete_rows: missing rows snapshots (legacy result?)',
      );
      return null;
    }
    return { toolName: 'table_delete_rows', sheet, rows };
  }

  if (toolName === 'table_edit_structure') {
    const inverses = structureInversesFromResult(result);
    if (!inverses) {
      console.warn('[table-restore] skip table_edit_structure: no invertible ops');
      return null;
    }
    return { toolName: 'table_edit_structure', sheet, inverses };
  }

  return null;
}

/** Chronological cell mutations from assistant tool parts in `messages`. */
export function collectTableCellMutations(
  messages: readonly UiMessage[],
): TableCellMutation[] {
  const out: TableCellMutation[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parts) continue;
    for (const part of message.parts) {
      const mutation = mutationFromPart(part);
      if (mutation) out.push(mutation);
    }
  }
  return out;
}

/** Apply inverse of one mutation. Returns false when the inverse could not run. */
export async function undoTableCellMutation(
  mutation: TableCellMutation,
): Promise<boolean> {
  switch (mutation.toolName) {
    case 'table_set_cell':
    case 'table_update_row': {
      const result = await updateTableRow(
        mutation.rowKey,
        mutation.previous,
        mutation.sheet,
      );
      if (!result.ok) {
        console.warn(
          `[table-restore] failed to restore cells on ${mutation.rowKey}: ${result.message}`,
        );
      }
      return result.ok;
    }
    case 'table_update_cells': {
      let any = false;
      for (const row of mutation.rows) {
        const result = await updateTableRow(row.rowKey, row.previous, mutation.sheet);
        if (result.ok) any = true;
        else {
          console.warn(
            `[table-restore] failed to restore cells on ${row.rowKey}: ${result.message}`,
          );
        }
      }
      return any;
    }
    case 'table_add_row': {
      const { removed } = deleteTableRows(mutation.sheet, [mutation.rowId]);
      return removed > 0;
    }
    case 'table_delete_rows': {
      const restored = restoreDeletedTableRows(mutation.sheet, mutation.rows);
      return restored > 0;
    }
    case 'table_edit_structure': {
      let any = false;
      for (const inv of mutation.inverses) {
        if (inv.kind === 'delete_added_rows') {
          const { removed } = deleteTableRows(mutation.sheet, inv.rowIds);
          if (removed > 0) any = true;
        } else if (inv.kind === 'restore_deleted_rows') {
          const restored = restoreDeletedTableRows(mutation.sheet, inv.rows);
          if (restored > 0) any = true;
        }
        // skip column ops
      }
      return any;
    }
    default:
      return false;
  }
}

/**
 * Undo cell-level table writes found in removed transcript messages (newest first).
 */
export async function undoTableCellMutationsFromRemovedMessages(
  removedMessages: readonly UiMessage[],
): Promise<number> {
  const mutations = collectTableCellMutations(removedMessages);
  if (mutations.length === 0) return 0;
  let undone = 0;
  for (let i = mutations.length - 1; i >= 0; i--) {
    const ok = await undoTableCellMutation(mutations[i]!);
    if (ok) undone++;
  }
  return undone;
}

/** Messages after the shared id prefix — the part dropped by a linear truncate. */
export function removedMessagesAfterPrefix(
  stored: readonly UiMessage[],
  client: readonly UiMessage[],
): UiMessage[] {
  const storedIds = stored.map((m) => m.id).filter((id): id is string => Boolean(id));
  const clientIds = client.map((m) => m.id).filter((id): id is string => Boolean(id));
  let prefix = 0;
  const limit = Math.min(storedIds.length, clientIds.length);
  while (prefix < limit && storedIds[prefix] === clientIds[prefix]) prefix++;

  // When ids are missing, fall back to length truncate (client shorter → drop tail).
  if (storedIds.length === 0 && clientIds.length === 0) {
    if (client.length < stored.length) return stored.slice(client.length) as UiMessage[];
    return [];
  }
  return stored.slice(prefix) as UiMessage[];
}
