/**
 * Multi-sheet table store with SurrealDB persistence.
 */

import {
  countTableSheets,
  deleteTableSheet as deleteTableSheetDb,
  listTableColumns as listTableColumnsDb,
  listTableRows as listTableRowsDb,
  listTableSheets as listTableSheetsDb,
  replaceTableColumns,
  replaceTableRows,
  upsertTableSheet,
} from '@veylin/db';
import { DEFAULT_TABLE_STATUS_OPTIONS } from '@veylin/shared';
import { EventEmitter } from 'node:events';

export type TableColumnType = 'text' | 'number' | 'status';

export interface TableColumnDef {
  key: string;
  name: string;
  width: number;
  type: TableColumnType;
  frozen?: boolean;
  deletable: boolean;
  statusOptions?: string[];
}

export interface TableSheetMeta {
  id: string;
  name: string;
  builtin: boolean;
}

export type TableRowData = Record<string, string | number> & { row_id: string };

export type TableRowPatch = Record<string, string | number>;

/**
 * Row-level table change events for live SSE sync. Every mutator emits one, so the
 * web client can replace its 4s full-sheet poll with an EventSource + local row deltas.
 */
export type TableEvent =
  | { type: 'rowUpsert'; sheet: string; row: TableRowData }
  | { type: 'rowsDelete'; sheet: string; keys: string[] }
  | { type: 'sheetReplace'; sheet: string }
  | { type: 'schemaChange'; sheet: string }
  | { type: 'sheetsChange' };

const tableEvents = new EventEmitter();
tableEvents.setMaxListeners(0);

/** Subscribe to table change events (for the SSE endpoint). Returns an unsubscribe fn. */
export function onTableEvent(cb: (event: TableEvent) => void): () => void {
  tableEvents.on('change', cb);
  return () => {
    tableEvents.off('change', cb);
  };
}

function emitTable(event: TableEvent): void {
  tableEvents.emit('change', event);
}

export const DEFAULT_TABLE_SHEET = 'main';

/** New sheets start with no preset columns — user adds columns as needed. */
const DEFAULT_COLUMNS: TableColumnDef[] = [];

const LEGACY_COLUMN_KEYS = [
  'order_no',
  'product',
  'qty',
  'planned_start',
  'planned_end',
  'resource',
  'status',
] as const;

const BUILTIN_SHEETS: TableSheetMeta[] = [
  { id: 'main', name: 'Sheet 1', builtin: true },
];

interface SheetState {
  meta: TableSheetMeta;
  columns: TableColumnDef[];
  rows: TableRowData[];
}

function cloneColumns(): TableColumnDef[] {
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
}

function tableRowKey(row: TableRowData): string {
  return String(row.row_id);
}

function emptyRow(): TableRowData {
  return {
    row_id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  };
}

function isLegacyDefaultColumns(columns: TableColumnDef[]): boolean {
  if (columns.length !== LEGACY_COLUMN_KEYS.length) return false;
  return columns.every((c, i) => c.key === LEGACY_COLUMN_KEYS[i]);
}

function sheetHasNoCellData(sheet: SheetState): boolean {
  if (sheet.rows.length === 0) return true;
  return sheet.rows.every((row) =>
    sheet.columns.every((col) => {
      const v = row[col.key];
      return v === undefined || v === null || v === '';
    }),
  );
}

/** Drop unused legacy preset columns when the sheet is still empty. */
function migrateLegacyEmptySheet(sheet: SheetState): boolean {
  if (!isLegacyDefaultColumns(sheet.columns) || !sheetHasNoCellData(sheet)) return false;
  sheet.columns = [];
  sheet.rows = [];
  if (sheet.meta.builtin && sheet.meta.name === 'Main Plan') {
    sheet.meta.name = 'Sheet 1';
  }
  return true;
}

function defaultStatusOptionsForColumn(col: TableColumnDef, applyDefaults: boolean): string[] | undefined {
  if (col.type !== 'status') return undefined;
  if (col.statusOptions?.length) return col.statusOptions;
  if (!applyDefaults) return undefined;
  return [...DEFAULT_TABLE_STATUS_OPTIONS];
}

function normalizeStatusColumn(col: TableColumnDef, applyDefaults = false): TableColumnDef {
  if (col.type !== 'status') return col;
  const statusOptions = defaultStatusOptionsForColumn(col, applyDefaults);
  return statusOptions ? { ...col, statusOptions } : col;
}

function buildInitialStore(): Map<string, SheetState> {
  const store = new Map<string, SheetState>();
  for (const meta of BUILTIN_SHEETS) {
    store.set(meta.id, {
      meta: { ...meta },
      columns: cloneColumns(),
      rows: [],
    });
  }
  return store;
}

let sheetStore = buildInitialStore();
let tableHydrated = false;

/** Per-sheet serial persist chain so concurrent fire-and-forget writes cannot interleave. */
const persistChains = new Map<string, Promise<void>>();

/** Write the *current* in-memory snapshot for a sheet (re-read at call time). */
async function persistSheetLatest(sheetId: string): Promise<void> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return;
  await upsertTableSheet({ ...sheet.meta });
  await replaceTableColumns(
    sheetId,
    sheet.columns.map((c, i) => ({
      sheetId,
      key: c.key,
      name: c.name,
      width: c.width,
      type: c.type,
      frozen: c.frozen,
      deletable: c.deletable,
      position: i,
      statusOptions: c.statusOptions,
    })),
  );
  await replaceTableRows(
    sheetId,
    sheet.rows.map((r, i) => ({
      sheetId,
      rowKey: tableRowKey(r),
      data: { ...r },
      position: i,
    })),
  );
}

function enqueuePersist(sheetId: string): Promise<void> {
  const prev = persistChains.get(sheetId) ?? Promise.resolve();
  // Swallow errors on the chain itself so fire-and-forget callers (and the
  // detached `.finally` cleanup) never leave an unhandledRejection — unit tests
  // without connectDb() would otherwise fail after the test ends.
  const next = prev
    .catch(() => undefined)
    .then(() => persistSheetLatest(sheetId))
    .catch((e) => {
      console.error('[table] persist failed:', e);
    });
  persistChains.set(sheetId, next);
  void next.finally(() => {
    if (persistChains.get(sheetId) === next) persistChains.delete(sheetId);
  });
  return next;
}

async function persistAll(): Promise<void> {
  for (const id of sheetStore.keys()) {
    await enqueuePersist(id);
  }
}

/** Fire-and-forget persist; errors are logged inside the per-sheet chain. */
function tablePersist(sheetId: string): void {
  void enqueuePersist(sheetId);
}

/** Wait for in-flight sheet persists (call before closing the DB). */
export async function flushTablePersists(): Promise<void> {
  const pending = [...persistChains.values()];
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}

/** Load tables from SurrealDB or seed builtin sheets on first run. */
export async function initTableStore(): Promise<void> {
  if (tableHydrated) return;
  const count = await countTableSheets();
  if (count === 0) {
    sheetStore = buildInitialStore();
    await persistAll();
  } else {
    const sheets = await listTableSheetsDb();
    const next = new Map<string, SheetState>();
    for (const meta of sheets) {
      const columns = await listTableColumnsDb(meta.id);
      const rows = await listTableRowsDb(meta.id);
      next.set(meta.id, {
        meta,
        columns: columns.map((c) =>
          normalizeStatusColumn({
            key: c.key,
            name: c.name,
            width: c.width,
            type: c.type as TableColumnType,
            frozen: c.frozen,
            deletable: c.deletable,
            statusOptions: c.statusOptions,
          }),
        ),
        rows: rows.map((r) => ({ ...r.data } as TableRowData)),
      });
    }
    sheetStore = next;
    if (!sheetStore.has(DEFAULT_TABLE_SHEET)) {
      const initial = buildInitialStore();
      const main = initial.get(DEFAULT_TABLE_SHEET)!;
      sheetStore.set(DEFAULT_TABLE_SHEET, main);
      await enqueuePersist(DEFAULT_TABLE_SHEET);
    }
    let migrated = false;
    for (const sheet of sheetStore.values()) {
      if (migrateLegacyEmptySheet(sheet)) migrated = true;
    }
    if (migrated) await persistAll();
  }
  tableHydrated = true;
}

function getSheet(sheetId: string): SheetState | undefined {
  return sheetStore.get(sheetId);
}

function slugifyColumnKey(name: string, columns: TableColumnDef[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '') || 'col';
  let key = base;
  let n = 1;
  while (columns.some((c) => c.key === key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

function isAllowedStatusValue(value: string, col: TableColumnDef): boolean {
  if (!col.statusOptions?.length) return value.length > 0;
  return col.statusOptions.includes(value);
}

function findColumn(
  columns: TableColumnDef[],
  field: string,
): TableColumnDef | undefined {
  return columns.find((c) => c.key === field) ?? columns.find((c) => c.name === field);
}

export type RejectedPatchField = {
  /** Original key from the patch (may be display name). */
  field: string;
  columnKey?: string;
  reason: string;
};

export type SanitizePatchResult = {
  applied: TableRowPatch;
  rejected: RejectedPatchField[];
};

/**
 * Map a patch onto column keys (accepts key or display name).
 * Invalid number/status values are rejected with reasons — never silently dropped.
 */
export function sanitizePatch(
  patch: TableRowPatch,
  columns: TableColumnDef[],
): SanitizePatchResult {
  const applied: TableRowPatch = {};
  const rejected: RejectedPatchField[] = [];

  for (const [field, raw] of Object.entries(patch)) {
    if (field === 'row_id') continue;
    const col = findColumn(columns, field);
    if (!col) {
      rejected.push({ field, reason: `Unknown column "${field}"` });
      continue;
    }
    if (col.type === 'number') {
      if (raw === '' || raw === undefined) {
        applied[col.key] = '';
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        rejected.push({
          field,
          columnKey: col.key,
          reason: `Invalid number value "${String(raw)}" for column "${col.name || col.key}"`,
        });
        continue;
      }
      applied[col.key] = n;
    } else if (col.type === 'status') {
      if (raw === '' || raw === undefined) {
        applied[col.key] = '';
        continue;
      }
      const value = String(raw).trim();
      if (!isAllowedStatusValue(value, col)) {
        const allowed = col.statusOptions?.length
          ? col.statusOptions.join(', ')
          : '(any non-empty string)';
        rejected.push({
          field,
          columnKey: col.key,
          reason: `Invalid status value "${value}" for column "${col.name || col.key}"; allowed: ${allowed}`,
        });
        continue;
      }
      applied[col.key] = value;
    } else {
      applied[col.key] = String(raw);
    }
  }

  return { applied, rejected };
}

/** Resolve sheet id; unknown/missing values fall back to main (read paths). */
export function resolveTableSheetId(value: string | undefined): string {
  if (value && sheetStore.has(value)) return value;
  return DEFAULT_TABLE_SHEET;
}

/**
 * Resolve sheet for writes. `undefined`/`''` → main when it exists;
 * an explicit unknown id returns null (do not silently write main).
 */
export function tryResolveTableSheetId(value: string | undefined): string | null {
  if (value === undefined || value === '') {
    return sheetStore.has(DEFAULT_TABLE_SHEET) ? DEFAULT_TABLE_SHEET : null;
  }
  return sheetStore.has(value) ? value : null;
}

export function listTableSheets(): TableSheetMeta[] {
  return [...sheetStore.values()].map((s) => ({ ...s.meta }));
}

export function listTableColumns(sheetId: string): TableColumnDef[] {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  return sheet ? sheet.columns.map((c) => ({ ...c })) : [];
}

export function listTableRows(sheetId: string = DEFAULT_TABLE_SHEET): TableRowData[] {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  return sheet ? sheet.rows.map((r) => ({ ...r })) : [];
}

export function countTableRows(sheetId: string = DEFAULT_TABLE_SHEET): number {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  return sheet?.rows.length ?? 0;
}

export const DEFAULT_TABLE_GET_LIMIT = 50;
export const MAX_TABLE_GET_LIMIT = 200;

/** Paginated row read for table_get — avoids multi‑MB tool payloads on large sheets. */
export function listTableRowsPage(
  sheetId: string,
  offset = 0,
  limit = DEFAULT_TABLE_GET_LIMIT,
): { totalRows: number; rows: TableRowData[] } {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return { totalRows: 0, rows: [] };
  const totalRows = sheet.rows.length;
  const safeOffset = Math.max(0, Math.min(offset, totalRows));
  const safeLimit = Math.max(1, Math.min(limit, MAX_TABLE_GET_LIMIT));
  return {
    totalRows,
    rows: sheet.rows.slice(safeOffset, safeOffset + safeLimit).map((r) => ({ ...r })),
  };
}

export type TableSheetSnapshot = {
  id: string;
  name: string;
  columns: Array<{ key: string; name: string }>;
  rowCount: number;
  sampleRows: TableRowData[];
};

/** Format live table snapshots for the agent system prompt (right-panel 表格). */
export function formatTableContextBlock(snapshots: TableSheetSnapshot[]): string {
  if (snapshots.length === 0) return '';

  const lines: string[] = [
    '# Table / spreadsheet data (live snapshot)',
    'The workspace **表格** panel holds multi-sheet spreadsheet data. This is separate from the knowledge base (uploaded documents).',
    'Before saying there is no data, check this block and call `table_sheets` (action list) / `table_get` when row counts are non-zero.',
  ];

  for (const sheet of snapshots) {
    const colLabel = sheet.columns
      .map((c) => c.name || c.key)
      .filter(Boolean)
      .join(', ');
    lines.push(`## Sheet "${sheet.name}" (id: \`${sheet.id}\`)`);
    lines.push(
      `- ${sheet.rowCount} row(s), ${sheet.columns.length} column(s)${colLabel ? `: ${colLabel}` : ''}`,
    );
    if (sheet.sampleRows.length > 0) {
      lines.push('- Sample rows:');
      for (const row of sheet.sampleRows) {
        const keys =
          sheet.columns.length > 0
            ? sheet.columns.map((c) => c.key)
            : Object.keys(row).filter((k) => k !== 'row_id');
        const pairs = keys
          .slice(0, 5)
          .map((k) => `${k}=${String(row[k] ?? '').slice(0, 48)}`)
          .join(', ');
        lines.push(`  - \`${row.row_id}\`: ${pairs}`);
      }
    }
    lines.push(
      `- Use \`table_get\` with \`{ "sheet": "${sheet.id}", "offset": 0, "limit": 50 }\` (paginate; ${sheet.rowCount} rows total).`,
    );
  }

  return lines.join('\n');
}

/** Inject current table state so the model does not miss right-panel spreadsheet data. */
export function buildTableContextBlock(): string {
  const snapshots = listTableSheets().map((meta) => {
    const columns = listTableColumns(meta.id);
    const rows = listTableRows(meta.id);
    return {
      id: meta.id,
      name: meta.name,
      columns: columns.map((c) => ({ key: c.key, name: c.name })),
      rowCount: rows.length,
      sampleRows: rows.slice(0, 3),
    };
  });
  return formatTableContextBlock(snapshots);
}

export function getTableRow(rowKey: string, sheetId: string = DEFAULT_TABLE_SHEET) {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  const found = sheet?.rows.find((r) => tableRowKey(r) === rowKey);
  return found ? { ...found } : undefined;
}

export type UpdateTableRowResult =
  | {
      ok: true;
      row: TableRowData;
      sheet: string;
      applied: TableRowPatch;
      /** Previous values for keys in `applied` (before this write). */
      previous: TableRowPatch;
      rejected: RejectedPatchField[];
    }
  | {
      ok: false;
      row: TableRowData | null;
      sheet: string;
      applied: TableRowPatch;
      previous: TableRowPatch;
      rejected: RejectedPatchField[];
      message: string;
    };

export async function updateTableRow(
  rowKey: string,
  patch: TableRowPatch,
  sheetId: string = DEFAULT_TABLE_SHEET,
): Promise<UpdateTableRowResult> {
  // Callers that already validated the id pass a known sheet; otherwise require
  // an existing id (explicit unknown id must not fall back to main).
  const effectiveSheetId = sheetStore.has(sheetId)
    ? sheetId
    : sheetId === DEFAULT_TABLE_SHEET
      ? tryResolveTableSheetId(undefined)
      : null;

  if (!effectiveSheetId) {
    return {
      ok: false,
      row: null,
      sheet: sheetId,
      applied: {},
      previous: {},
      rejected: [],
      message: `Sheet "${sheetId}" not found`,
    };
  }

  const sheet = getSheet(effectiveSheetId);
  if (!sheet) {
    return {
      ok: false,
      row: null,
      sheet: effectiveSheetId,
      applied: {},
      previous: {},
      rejected: [],
      message: `Sheet "${effectiveSheetId}" not found`,
    };
  }

  const idx = sheet.rows.findIndex((r) => tableRowKey(r) === rowKey);
  if (idx === -1) {
    return {
      ok: false,
      row: null,
      sheet: effectiveSheetId,
      applied: {},
      previous: {},
      rejected: [],
      message: `Row ${rowKey} not found`,
    };
  }

  const { applied, rejected } = sanitizePatch(patch, sheet.columns);
  const hasApplied = Object.keys(applied).length > 0;
  const requested = Object.keys(patch).filter((k) => k !== 'row_id');
  const current = sheet.rows[idx]!;
  const previous: TableRowPatch = {};
  for (const key of Object.keys(applied)) {
    const prev = current[key];
    previous[key] = prev === undefined ? '' : prev;
  }

  if (requested.length > 0 && !hasApplied) {
    return {
      ok: false,
      row: { ...current },
      sheet: effectiveSheetId,
      applied,
      previous,
      rejected,
      message: rejected.map((r) => r.reason).join('; ') || 'No fields applied',
    };
  }

  if (hasApplied) {
    sheet.rows[idx] = { ...current, ...applied };
    tablePersist(effectiveSheetId);
    emitTable({
      type: 'rowUpsert',
      sheet: effectiveSheetId,
      row: { ...sheet.rows[idx]! },
    });
  }

  return {
    ok: true,
    row: { ...sheet.rows[idx]! },
    sheet: effectiveSheetId,
    applied,
    previous,
    rejected,
  };
}

function slugifySheetId(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '') || 'sheet';
  let id = base;
  let n = 1;
  while (sheetStore.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

/** Display-name key for uniqueness (trim + case-insensitive). */
function sheetNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** True if another sheet already uses this display name (case-insensitive). */
export function isTableSheetNameTaken(name: string, excludeSheetId?: string): boolean {
  const key = sheetNameKey(name);
  if (!key) return false;
  for (const other of sheetStore.values()) {
    if (excludeSheetId && other.meta.id === excludeSheetId) continue;
    if (sheetNameKey(other.meta.name) === key) return true;
  }
  return false;
}

export function createTableSheet(name: string): TableSheetMeta | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Display names must be unique so the model can tell sheets apart in context.
  if (isTableSheetNameTaken(trimmed)) return null;
  const id = slugifySheetId(trimmed);
  const meta: TableSheetMeta = { id, name: trimmed, builtin: false };
  sheetStore.set(id, {
    meta,
    columns: cloneColumns(),
    rows: [],
  });
  tablePersist(id);
  emitTable({ type: 'sheetsChange' });
  return { ...meta };
}

/** Rename a sheet's display name. Sheet id stays stable so tool/API references keep working. */
export function renameTableSheet(sheetId: string, name: string): TableSheetMeta | null {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (sheet.meta.name === trimmed) return { ...sheet.meta };
  if (isTableSheetNameTaken(trimmed, sheetId)) return null;
  sheet.meta = { ...sheet.meta, name: trimmed };
  tablePersist(sheetId);
  emitTable({ type: 'sheetsChange' });
  return { ...sheet.meta };
}

export async function deleteTableSheet(sheetId: string): Promise<boolean> {
  const sheet = sheetStore.get(sheetId);
  if (!sheet) return false;
  const snapshot: SheetState = {
    meta: { ...sheet.meta },
    columns: sheet.columns.map((c) => ({ ...c })),
    rows: sheet.rows.map((r) => ({ ...r })),
  };
  sheetStore.delete(sheetId);
  try {
    await deleteTableSheetDb(sheetId);
    await ensureAtLeastOneSheet();
    emitTable({ type: 'sheetsChange' });
    return true;
  } catch (e) {
    console.error('[table] delete sheet failed:', e);
    sheetStore.set(sheetId, snapshot);
    if (sheetStore.size === 0) {
      try {
        await ensureAtLeastOneSheet();
      } catch (ensureError) {
        console.error('[table] ensure default sheet after rollback failed:', ensureError);
      }
    }
    return false;
  }
}

/** After deleting the last sheet, seed a fresh default Sheet 1. */
async function ensureAtLeastOneSheet(): Promise<void> {
  if (sheetStore.size > 0) return;
  const initial = buildInitialStore();
  const main = initial.get(DEFAULT_TABLE_SHEET)!;
  sheetStore.set(DEFAULT_TABLE_SHEET, main);
  await enqueuePersist(DEFAULT_TABLE_SHEET);
}

export function addTableRow(sheetId: string): TableRowData | null {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return null;
  const row = emptyRow();
  sheet.rows.push(row);
  tablePersist(resolveTableSheetId(sheetId));
  emitTable({ type: 'rowUpsert', sheet: resolveTableSheetId(sheetId), row: { ...row } });
  return { ...row };
}

/** Snapshot of a row removed by deleteTableRows, for transcript rewind restore. */
export type DeletedTableRowSnapshot = {
  index: number;
  row: TableRowData;
};

export type DeleteTableRowsResult = {
  removed: number;
  rows: DeletedTableRowSnapshot[];
};

export function deleteTableRows(
  sheetId: string,
  rowKeys: string[],
): DeleteTableRowsResult {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet || rowKeys.length === 0) return { removed: 0, rows: [] };
  const drop = new Set(rowKeys);
  const removedRows: DeletedTableRowSnapshot[] = [];
  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    if (drop.has(tableRowKey(row))) {
      removedRows.push({ index: i, row: { ...row } });
    }
  }
  if (removedRows.length === 0) return { removed: 0, rows: [] };
  sheet.rows = sheet.rows.filter((r) => !drop.has(tableRowKey(r)));
  const effectiveId = resolveTableSheetId(sheetId);
  tablePersist(effectiveId);
  emitTable({
    type: 'rowsDelete',
    sheet: effectiveId,
    keys: removedRows.map((s) => tableRowKey(s.row)),
  });
  return { removed: removedRows.length, rows: removedRows };
}

/**
 * Re-insert rows at their recorded indices (ascending). Used to undo delete_rows
 * after a transcript truncate. Skips keys that already exist.
 */
export function restoreDeletedTableRows(
  sheetId: string,
  snapshots: DeletedTableRowSnapshot[],
): number {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet || snapshots.length === 0) return 0;
  const existing = new Set(sheet.rows.map(tableRowKey));
  const ordered = [...snapshots].sort((a, b) => a.index - b.index);
  let restored = 0;
  for (const snap of ordered) {
    const key = tableRowKey(snap.row);
    if (existing.has(key)) continue;
    const row = { ...snap.row };
    const at = Math.max(0, Math.min(snap.index, sheet.rows.length));
    sheet.rows.splice(at, 0, row);
    existing.add(key);
    restored++;
    emitTable({
      type: 'rowUpsert',
      sheet: resolveTableSheetId(sheetId),
      row: { ...row },
    });
  }
  if (restored > 0) tablePersist(resolveTableSheetId(sheetId));
  return restored;
}

export function addTableColumn(sheetId: string, name: string): TableColumnDef | null {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  const trimmed = name.trim();
  if (!sheet || !trimmed) return null;
  const type = inferColumnType(trimmed);
  const col: TableColumnDef = normalizeStatusColumn({
    key: slugifyColumnKey(trimmed, sheet.columns),
    name: trimmed,
    width: 110,
    type,
    deletable: true,
  }, true);
  sheet.columns.push(col);
  tablePersist(resolveTableSheetId(sheetId));
  emitTable({ type: 'schemaChange', sheet: resolveTableSheetId(sheetId) });
  return { ...col };
}

export function deleteTableColumn(sheetId: string, columnKey: string): boolean {
  const sheet = getSheet(resolveTableSheetId(sheetId));
  if (!sheet) return false;
  const col = sheet.columns.find((c) => c.key === columnKey);
  if (!col || !col.deletable) return false;
  sheet.columns = sheet.columns.filter((c) => c.key !== columnKey);
  for (const row of sheet.rows) {
    delete row[columnKey];
  }
  tablePersist(resolveTableSheetId(sheetId));
  emitTable({ type: 'schemaChange', sheet: resolveTableSheetId(sheetId) });
  return true;
}

function normalizeImportedRow(
  raw: TableRowPatch,
  columns: TableColumnDef[],
): TableRowPatch {
  const out: TableRowPatch = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'row_id') continue;
    const col =
      columns.find((c) => c.key === k) ?? columns.find((c) => c.name === k);
    if (col) out[col.key] = v;
  }
  return out;
}

function inferColumnType(name: string): TableColumnType {
  const lower = name.trim().toLowerCase();
  if (lower === 'status' || lower === '状态') return 'status';
  return 'text';
}

function buildColumnsFromNames(names: string[]): TableColumnDef[] {
  const columns: TableColumnDef[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    columns.push(
      normalizeStatusColumn({
        key: slugifyColumnKey(name, columns),
        name,
        width: 110,
        type: inferColumnType(name),
        deletable: true,
      }, true),
    );
  }
  return columns;
}

/** Replace sheet columns and rows from an Excel import. */
export function importTableSheet(
  sheetId: string,
  columnNames: string[],
  importedRows: TableRowPatch[],
): { columns: TableColumnDef[]; rows: TableRowData[] } | null {
  const resolved = resolveTableSheetId(sheetId);
  const sheet = getSheet(resolved);
  if (!sheet) return null;

  const fresh = getSheet(resolved);
  if (!fresh) return null;

  fresh.columns = buildColumnsFromNames(columnNames);

  fresh.rows = importedRows.map((raw) => {
    const base = emptyRow();
    const mapped = normalizeImportedRow(raw, fresh.columns);
    const { applied } = sanitizePatch(mapped, fresh.columns);
    return { ...base, ...applied };
  });

  tablePersist(resolved);
  emitTable({ type: 'sheetReplace', sheet: resolved });

  return {
    columns: fresh.columns.map((c) => ({ ...c })),
    rows: fresh.rows.map((r) => ({ ...r })),
  };
}

export async function resetTableStore(): Promise<void> {
  sheetStore = buildInitialStore();
  await persistAll();
}
