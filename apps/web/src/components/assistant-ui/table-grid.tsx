import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Minus, Redo2, Undo2, Upload, Download, X, Loader2 } from 'lucide-react';
import {
  DataGrid,
  SELECT_COLUMN_KEY,
  type CellCopyArgs,
  type CellKeyDownArgs,
  type CellKeyboardEvent,
  type CellMouseArgs,
  type CellMouseEvent,
  type CellPasteArgs,
  type Column,
  type RenderCellProps,
  type RenderEditCellProps,
  type RenderHeaderCellProps,
  type RowsChangeData,
  type SortColumn,
  type SortDirection,
} from 'react-data-grid';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { exportTableToExcel, parseTableExcelFile } from '@/lib/table-excel';
import {
  createNextThreadSheet,
  createThreadSheet,
  fetchThreadSheets,
  nextSequentialSheetName,
  type TableSheetMeta,
} from '@/lib/table-sheets';
import { DEFAULT_TABLE_STATUS_OPTIONS, applyColumnFilters, applyTextQuery, sortRows } from '@veylin/shared';

type TableColumnType = 'text' | 'number' | 'status';

type TableRow = Record<string, string | number> & { row_id?: string };

function rowKey(row: TableRow): string {
  return String(row.row_id ?? '');
}

/** Soft large-sheet thresholds — full data stays in memory; grid render is capped. */
const SOFT_ROW_WARN = 5000;
const SOFT_ROW_RENDER_CAP = 2000;

// Live-sync events pushed over SSE from /api/table/stream (mirrors the server's
// TableEvent union). Applied as row-level deltas so update cost is independent of
// sheet size — the whole reason the 4s full-sheet poll is gone.
type TableEvent =
  | { type: 'rowUpsert'; sheet: string; row: TableRow }
  | { type: 'rowsDelete'; sheet: string; keys: string[] }
  | { type: 'sheetReplace'; sheet: string }
  | { type: 'schemaChange'; sheet: string }
  | { type: 'sheetsChange' };

interface TableColumnDef {
  key: string;
  name: string;
  width: number;
  type: TableColumnType;
  frozen?: boolean;
  deletable: boolean;
  statusOptions?: string[];
}

interface TableSheet {
  id: string;
  name: string;
  builtin: boolean;
}

function asTableSheet(meta: TableSheetMeta): TableSheet {
  return { id: meta.id, name: meta.name, builtin: meta.builtin };
}

interface TableGridTotals {
  /** Rows currently rendered in the grid (after filter + optional CAP). */
  shownCount: number;
  /** Rows matching filters (before CAP). */
  matchedCount: number;
  /** All rows in the sheet (before filters). */
  totalCount: number;
  selectedCount: number;
  capped: boolean;
}

type FilterState = {
  query: string;
};

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  normal: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  tight: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

function statusClass(value: string): string {
  return STATUS_STYLE[value] ?? 'bg-muted text-muted-foreground';
}

function humanizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function resolveStatusOptions(def: TableColumnDef, rows: TableRow[]): string[] {
  const seen = new Set<string>();
  for (const opt of def.statusOptions?.length ? def.statusOptions : DEFAULT_TABLE_STATUS_OPTIONS) {
    seen.add(opt);
  }
  for (const row of rows) {
    const v = String(row[def.key] ?? '').trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

const EMPTY_FILTERS: FilterState = { query: '' };
const HISTORY_LIMIT = 20;
const SELECT_COL_KEY = SELECT_COLUMN_KEY;

type ScheduleEdit = {
  rowKey: string;
  columnKey: string;
  before: string | number;
  after: string | number;
};

type HistoryBatch = ScheduleEdit[];

type SchedulePayload = {
  sheet?: string;
  sheets?: TableSheet[];
  columns?: TableColumnDef[];
  rows?: TableRow[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(i18n.t('table.noResponse', { status: res.status }));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(i18n.t('table.invalidResponse', { status: res.status }));
  }
}

async function fetchSchedule(sheetId: string, threadId?: string | null): Promise<SchedulePayload> {
  const q = new URLSearchParams({ sheet: sheetId });
  if (threadId?.trim()) q.set('threadId', threadId.trim());
  const res = await fetch(`/api/table?${q}`);
  const data = await readJsonResponse<SchedulePayload>(res);
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
}

async function fetchSheetList(threadId?: string | null): Promise<TableSheet[]> {
  const sheets = await fetchThreadSheets(threadId);
  return sheets.map(asTableSheet);
}

async function patchRows(
  sheetId: string,
  rows: TableRow[],
  threadId?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (rows.length === 0) return { ok: true };
  try {
    const res = await fetch('/api/table/rows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: sheetId,
        ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
        rows: rows.map((row) => {
          const { row_id: _rowId, ...fields } = row;
          return {
            row_key: rowKey(row),
            ...fields,
          };
        }),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (res.ok && data.ok === true) return { ok: true };
    return { ok: false, message: data.message ?? `HTTP ${res.status}` };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' };
  }
}

function applyHistoryBatch(
  allRows: TableRow[],
  batch: HistoryBatch,
  mode: 'undo' | 'redo',
): TableRow[] {
  const valueKey = mode === 'undo' ? 'before' : 'after';
  return allRows.map((row) => {
    const key = rowKey(row);
    const edits = batch.filter((e) => e.rowKey === key);
    if (edits.length === 0) return row;
    let updated = { ...row };
    for (const edit of edits) {
      updated = { ...updated, [edit.columnKey]: edit[valueKey] };
    }
    return updated;
  });
}

function collectEdits(
  beforeRows: readonly TableRow[],
  afterRows: readonly TableRow[],
  columnKey: string,
  indexes: readonly number[],
  editableKeys: ReadonlySet<string>,
): HistoryBatch {
  const edits: HistoryBatch = [];
  if (!editableKeys.has(columnKey)) return edits;
  for (const idx of indexes) {
    const before = beforeRows[idx];
    const after = afterRows[idx];
    if (!before || !after) continue;
    const prev = before[columnKey];
    const next = after[columnKey];
    if (prev === next) continue;
    edits.push({
      rowKey: rowKey(after),
      columnKey,
      before: prev ?? '',
      after: next ?? '',
    });
  }
  return edits;
}

function cellTextValue(row: TableRow, columnKey: string): string {
  const value = row[columnKey];
  if (value === undefined || value === null) return '';
  return String(value);
}

function TableGridFooter({ totals }: { totals: TableGridTotals }) {
  const { t } = useTranslation();
  return (
    <div
      className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs"
      aria-live="polite"
      aria-atomic="true"
    >
      {totals.capped ? (
        <span className="text-foreground font-medium">
          {t('table.footerCapped', { shown: totals.shownCount, matched: totals.matchedCount })}
        </span>
      ) : (
        <span className="text-foreground font-medium">
          {t('table.footerTotal', { count: totals.matchedCount })}
        </span>
      )}
      {totals.selectedCount > 0 ? (
        <span>{t('table.footerSelected', { count: totals.selectedCount })}</span>
      ) : null}
    </div>
  );
}

function stopCellMouseDown(event: React.MouseEvent) {
  event.stopPropagation();
}

type ColumnSelectionCtx = {
  selectedKey: string | null;
  select: (key: string | null) => void;
  toggleSort: (columnKey: string) => void;
};

const ColumnSelectionContext = createContext<ColumnSelectionCtx | null>(null);

const SelectableColumnHeader = memo(function SelectableColumnHeader({
  columnKey,
  name,
  tabIndex,
  sortDirection,
}: {
  columnKey: string;
  name: string;
  tabIndex: number;
  sortDirection?: SortDirection;
}) {
  const { t } = useTranslation();
  const ctx = useContext(ColumnSelectionContext);
  const selected = ctx?.selectedKey === columnKey;
  return (
    <div className="flex size-full min-h-9 items-center justify-center gap-0.5 px-1">
      <button
        type="button"
        tabIndex={tabIndex}
        className={cn(
          'min-w-0 flex-1 truncate px-2 py-1 text-center text-xs outline-none',
          selected ? 'text-primary font-medium' : 'hover:bg-muted/60',
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          ctx?.select(selected ? null : columnKey);
        }}
      >
        {name}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('table.sortBy', { name })}
        className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          ctx?.toggleSort(columnKey);
        }}
      >
        {sortDirection === 'ASC' ? (
          <ChevronUp className="size-3.5" />
        ) : sortDirection === 'DESC' ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronUp className="size-3.5 opacity-25" />
        )}
      </button>
    </div>
  );
});

type RowSelectionCtx = {
  selectedRows: ReadonlySet<string>;
  visibleRowKeys: readonly string[];
  onRowSelect: (rowIdx: number, key: string, checked: boolean, shiftKey: boolean) => void;
  onSelectAll: (checked: boolean) => void;
};

const RowSelectionContext = createContext<RowSelectionCtx | null>(null);

function SelectAllHeader({ tabIndex }: { tabIndex: number }) {
  const { t } = useTranslation();
  const ctx = useContext(RowSelectionContext);
  const visibleKeys = ctx?.visibleRowKeys ?? [];
  const selectedRows = ctx?.selectedRows ?? new Set<string>();
  const allSelected =
    visibleKeys.length > 0 && visibleKeys.every((k) => selectedRows.has(k));
  const someSelected = visibleKeys.some((k) => selectedRows.has(k));

  return (
    <input
      type="checkbox"
      aria-label={t('table.selectAll')}
      tabIndex={tabIndex}
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = !allSelected && someSelected;
      }}
      onMouseDown={stopCellMouseDown}
      onChange={(e) => ctx?.onSelectAll(e.target.checked)}
    />
  );
}

function SelectRowCell({
  tabIndex,
  rowKeyValue,
  rowIdx,
}: {
  tabIndex: number;
  rowKeyValue: string;
  rowIdx: number;
}) {
  const { t } = useTranslation();
  const ctx = useContext(RowSelectionContext);
  const checked = ctx?.selectedRows.has(rowKeyValue) ?? false;
  return (
    <input
      type="checkbox"
      aria-label={t('table.selectRow')}
      tabIndex={tabIndex}
      checked={checked}
      onMouseDown={stopCellMouseDown}
      onChange={(e) =>
        ctx?.onRowSelect(rowIdx, rowKeyValue, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)
      }
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        statusClass(status),
      )}
    >
      {t(`table.status.${status}`, { defaultValue: humanizeStatus(status) })}
    </span>
  );
}

function StatusEditor({
  row,
  column,
  onRowChange,
  onClose,
  options,
}: RenderEditCellProps<TableRow> & { options: string[] }) {
  const { t } = useTranslation();
  const value = row[column.key] === undefined ? '' : String(row[column.key]);
  return (
    <select
      className="block size-full bg-background px-2 text-center text-sm outline-none"
      value={value}
      autoFocus
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value }, true)}
      onBlur={() => onClose(true)}
    >
      <option value=""> </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {t(`table.status.${opt}`, { defaultValue: humanizeStatus(opt) })}
        </option>
      ))}
    </select>
  );
}

function NumberEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<TableRow>) {
  const raw = row[column.key];
  const display = raw === undefined || raw === '' ? '' : String(raw);
  return (
    <input
      className="block size-full bg-background px-2 text-center text-sm outline-none"
      type="number"
      value={display}
      autoFocus
      onChange={(e) => {
        const v = e.target.value;
        onRowChange({ ...row, [column.key]: v === '' ? '' : Number(v) }, true);
      }}
      onBlur={() => onClose(true)}
    />
  );
}

function CenteredTextEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<TableRow>) {
  const value =
    row[column.key] === undefined || row[column.key] === null ? '' : String(row[column.key]);
  return (
    <input
      className="block size-full bg-background px-2 text-center text-sm outline-none"
      value={value}
      autoFocus
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value }, true)}
      onBlur={() => onClose(true)}
    />
  );
}

function cellDisplayValue(row: TableRow, key: string): string {
  const value = row[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

function buildDataColumn(def: TableColumnDef, rows: TableRow[]): Column<TableRow> {
  const headerCell = ({ tabIndex, sortDirection }: RenderHeaderCellProps<TableRow>) => (
    <SelectableColumnHeader
      columnKey={def.key}
      name={def.name}
      tabIndex={tabIndex}
      sortDirection={sortDirection}
    />
  );
  const base: Pick<Column<TableRow>, 'key' | 'name' | 'width' | 'frozen' | 'sortable' | 'renderHeaderCell'> = {
    key: def.key,
    name: def.name,
    width: def.width,
    frozen: def.frozen,
    sortable: true,
    renderHeaderCell: headerCell,
  };

  if (def.type === 'number') {
    return {
      ...base,
      renderEditCell: NumberEditor,
      renderCell: ({ row }) => (
        <span className="block w-full truncate px-2 text-center tabular-nums">
          {cellDisplayValue(row, def.key)}
        </span>
      ),
    };
  }
  if (def.type === 'status') {
    const options = resolveStatusOptions(def, rows);
    return {
      ...base,
      renderCell: ({ row }: RenderCellProps<TableRow>) => (
        <div className="flex w-full justify-center px-2">
          <StatusBadge status={String(row[def.key] ?? '')} />
        </div>
      ),
      renderEditCell: (props) => <StatusEditor {...props} options={options} />,
    };
  }
  return {
    ...base,
    renderEditCell: CenteredTextEditor,
    renderCell: ({ row }) => (
      <span className="block w-full truncate px-2 text-center">{cellDisplayValue(row, def.key)}</span>
    ),
  };
}

function makeOnCellPaste(editableKeys: ReadonlySet<string>) {
  return (args: CellPasteArgs<TableRow>, event: React.ClipboardEvent): TableRow => {
    const text = event.clipboardData.getData('text/plain').trim();
    const { column, row } = args;
    if (!editableKeys.has(column.key)) return row;
    if (column.key === 'qty' || column.key.includes('qty')) {
      const n = Number(text);
      if (!Number.isFinite(n)) return row;
      return { ...row, [column.key]: n };
    }
    if (
      column.key === 'status' &&
      (text === 'normal' || text === 'tight' || text === 'overdue')
    ) {
      return { ...row, status: text };
    }
    return { ...row, [column.key]: text };
  };
}

export type TableGridProps = {
  /** Current chat session — sheets are isolated per thread. */
  threadId?: string | null;
  /**
   * Active sheet for this panel tab (created when the user opens the tab via +).
   * TableGrid never auto-creates on mount. When `onBoundSheet` is set, switching
   * sheets updates the tab binding; the sheet strip still lists all thread sheets.
   */
  boundSheetId?: string | null;
  /** Persist the active sheet id (and title) onto the panel tab after switch / recreate. */
  onBoundSheet?: (sheetId: string, meta?: { title?: string }) => void;
};

export function TableGrid({
  threadId = null,
  boundSheetId,
  onBoundSheet,
}: TableGridProps = {}) {
  const { t } = useTranslation();
  const onBoundSheetRef = useRef(onBoundSheet);
  onBoundSheetRef.current = onBoundSheet;
  const bindingEnabled = onBoundSheet != null;

  const [sheets, setSheets] = useState<TableSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState(() =>
    typeof boundSheetId === 'string' && boundSheetId.trim()
      ? boundSheetId.trim()
      : bindingEnabled
        ? ''
        : 'main',
  );
  const [columnDefs, setColumnDefs] = useState<TableColumnDef[]>([]);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [undoStack, setUndoStack] = useState<HistoryBatch[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryBatch[]>([]);
  const [selectedColumnKey, setSelectedColumnKey] = useState<string | null>(null);

  const lastSerialized = useRef('');
  const editingUntil = useRef(0);
  const selectionAnchorRef = useRef<number | null>(null);
  const isApplyingHistory = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(
    null,
  );
  const [deleteSheetTarget, setDeleteSheetTarget] = useState<TableSheet | null>(null);
  const [deletingSheet, setDeletingSheet] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [addingSheet, setAddingSheet] = useState(false);
  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renamingSheet, setRenamingSheet] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCommitLockRef = useRef(false);
  const largeSheetWarnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToast({ message, variant });
  }, []);

  const maybeWarnLargeSheet = useCallback(
    (sheetId: string, rowCount: number) => {
      if (rowCount < SOFT_ROW_WARN) return;
      if (largeSheetWarnedRef.current.has(sheetId)) return;
      largeSheetWarnedRef.current.add(sheetId);
      showToast(t('table.largeSheetWarn', { count: rowCount, cap: SOFT_ROW_RENDER_CAP }), 'error');
    },
    [showToast, t],
  );

  const resetImportInput = useCallback(() => {
    if (importInputRef.current) importInputRef.current.value = '';
  }, []);

  const editableKeys = useMemo(
    () => new Set(columnDefs.map((c) => c.key)),
    [columnDefs],
  );
  const selectColumn = useCallback((key: string | null) => {
    setSelectedColumnKey(key);
    if (key) {
      setSelectedRows(new Set());
      selectionAnchorRef.current = null;
    }
  }, []);

  const clearColumnSelection = useCallback(() => setSelectedColumnKey(null), []);

  const resetSheetUiState = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSelectedRows(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSortColumns([]);
    setSelectedColumnKey(null);
    selectionAnchorRef.current = null;
    lastSerialized.current = '';
  }, []);

  const activeSheetIdRef = useRef(activeSheetId);
  activeSheetIdRef.current = activeSheetId;

  const applyPayload = useCallback(
    (data: SchedulePayload, _initial: boolean, preferSheetId?: string) => {
      if (data.sheets?.length) {
        setSheets(data.sheets);
      }
      if (data.columns) setColumnDefs(data.columns);
      const next = data.rows ?? [];
      if (_initial) setLoading(false);
      if (Date.now() < editingUntil.current) return;
      const serialized = JSON.stringify(next);
      if (serialized === lastSerialized.current) return;
      lastSerialized.current = serialized;
      setRows(next);
      const sheetForWarn = preferSheetId ?? data.sheet ?? activeSheetIdRef.current;
      if (sheetForWarn) maybeWarnLargeSheet(sheetForWarn, next.length);
    },
    [maybeWarnLargeSheet],
  );

  const load = useCallback(
    async (sheetId: string, initial: boolean) => {
      const attempts = initial ? 6 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          const data = await fetchSchedule(sheetId, threadId);
          setLoadError(null);
          applyPayload(data, initial, sheetId);
          return;
        } catch (err) {
          if (i < attempts - 1) {
            await sleep(400 * (i + 1));
            continue;
          }
          if (initial) {
            const message =
              err instanceof Error ? err.message : t('table.loadFailedGeneric');
            setLoadError(message);
            setLoading(false);
          }
        }
      }
    },
    [applyPayload, t, threadId],
  );

  const switchSheet = useCallback(
    (sheetId: string) => {
      if (sheetId === activeSheetId) return;
      resetSheetUiState();
      // Clear grid body so we never flash the previous sheet's rows, but keep
      // sheet tabs + toolbar mounted (loading paints only in the body).
      setRows([]);
      setColumnDefs([]);
      setLoadError(null);
      setActiveSheetId(sheetId);
      setLoading(true);
      const title = sheets.find((s) => s.id === sheetId)?.name;
      onBoundSheetRef.current?.(sheetId, title ? { title } : undefined);
    },
    [activeSheetId, resetSheetUiState, sheets],
  );

  const confirmDeleteSheet = async () => {
    if (!deleteSheetTarget || deletingSheet) return;
    setDeletingSheet(true);
    try {
      const delUrl = threadId?.trim()
        ? `/api/table/sheets/${encodeURIComponent(deleteSheetTarget.id)}?threadId=${encodeURIComponent(threadId.trim())}`
        : `/api/table/sheets/${encodeURIComponent(deleteSheetTarget.id)}`;
      const res = await fetch(delUrl, { method: 'DELETE' });
      const data = await readJsonResponse<{
        ok?: boolean;
        message?: string;
        sheets?: TableSheet[];
        nextSheet?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        showToast(data.message ?? t('table.deleteSheetFailed'), 'error');
        return;
      }
      if (data.sheets) setSheets(data.sheets);
      if (deleteSheetTarget.id === activeSheetId) {
        if (data.nextSheet) {
          resetSheetUiState();
          setActiveSheetId(data.nextSheet);
          setLoading(true);
          const nextTitle = data.sheets?.find((s) => s.id === data.nextSheet)?.name;
          onBoundSheetRef.current?.(
            data.nextSheet,
            nextTitle ? { title: nextTitle } : undefined,
          );
        } else if (bindingEnabled && threadId?.trim()) {
          // Last sheet deleted — create a fresh empty one for the bound tab.
          try {
            const created = await createNextThreadSheet(threadId.trim());
            resetSheetUiState();
            setSheets([asTableSheet(created)]);
            setActiveSheetId(created.id);
            setLoading(true);
            onBoundSheetRef.current?.(created.id, { title: created.name });
          } catch (err) {
            showToast(
              err instanceof Error ? err.message : t('table.createSheetFailed'),
              'error',
            );
          }
        }
      }
      setDeleteSheetTarget(null);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.deleteSheetFailed'), 'error');
    } finally {
      setDeletingSheet(false);
    }
  };

  const openAddSheetDialog = useCallback(() => {
    void nextSequentialSheetName(threadId, sheets).then((name) => {
      setNewSheetName(name);
      setAddSheetOpen(true);
    });
  }, [sheets, threadId]);

  const submitAddSheet = async () => {
    const name = newSheetName.trim();
    if (!name) return;
    if (!threadId?.trim()) {
      showToast(t('table.createSheetFailed'), 'error');
      return;
    }
    const taken = sheets.some((s) => s.name.trim().toLowerCase() === name.toLowerCase());
    if (taken) {
      showToast(t('table.sheetNameDuplicate'), 'error');
      return;
    }
    setAddingSheet(true);
    try {
      const sheet = asTableSheet(
        await createThreadSheet(threadId.trim(), name),
      );
      const list = await fetchSheetList(threadId);
      setSheets(list.length > 0 ? list : [sheet]);
      resetSheetUiState();
      setRows([]);
      setColumnDefs([]);
      setLoadError(null);
      setActiveSheetId(sheet.id);
      setLoading(true);
      onBoundSheetRef.current?.(sheet.id, { title: sheet.name });
      setAddSheetOpen(false);
      setNewSheetName('');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.createSheetFailed'), 'error');
    } finally {
      setAddingSheet(false);
    }
  };

  const beginRenameSheet = useCallback((sheet: TableSheet) => {
    setRenamingSheetId(sheet.id);
    setRenameDraft(sheet.name);
  }, []);

  const cancelRenameSheet = useCallback(() => {
    setRenamingSheetId(null);
    setRenameDraft('');
  }, []);

  const commitRenameSheet = useCallback(async () => {
    if (!renamingSheetId || renamingSheet) return;
    const name = renameDraft.trim();
    const current = sheets.find((s) => s.id === renamingSheetId);
    if (!name || !current || name === current.name) {
      cancelRenameSheet();
      return;
    }
    const taken = sheets.some(
      (s) => s.id !== renamingSheetId && s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (taken) {
      showToast(t('table.sheetNameDuplicate'), 'error');
      return;
    }
    setRenamingSheet(true);
    // Optimistic local update so the next chat turn's table context is not stale
    // while the PATCH is in flight (server buildTableContextBlock reads the store).
    setSheets((prev) =>
      prev.map((s) => (s.id === renamingSheetId ? { ...s, name } : s)),
    );
    try {
      const res = await fetch(`/api/table/sheets/${encodeURIComponent(renamingSheetId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
        }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        message?: string;
        sheet?: TableSheet;
        sheets?: TableSheet[];
      }>(res);
      if (!res.ok || !data.ok) {
        if (current) {
          setSheets((prev) =>
            prev.map((s) => (s.id === renamingSheetId ? current : s)),
          );
        }
        showToast(data.message ?? t('table.renameSheetFailed'), 'error');
        return;
      }
      if (data.sheets) {
        setSheets(data.sheets);
      } else if (data.sheet) {
        setSheets((prev) =>
          prev.map((s) => (s.id === data.sheet!.id ? { ...s, ...data.sheet! } : s)),
        );
      }
      if (data.sheet && data.sheet.id === activeSheetIdRef.current) {
        onBoundSheetRef.current?.(data.sheet.id, { title: data.sheet.name });
      }
      cancelRenameSheet();
    } catch (e: unknown) {
      if (current) {
        setSheets((prev) =>
          prev.map((s) => (s.id === renamingSheetId ? current : s)),
        );
      }
      showToast(e instanceof Error ? e.message : t('table.renameSheetFailed'), 'error');
    } finally {
      setRenamingSheet(false);
    }
  }, [
    cancelRenameSheet,
    renameDraft,
    renamingSheet,
    renamingSheetId,
    sheets,
    showToast,
    t,
    threadId,
  ]);

  useEffect(() => {
    if (!renamingSheetId) return;
    const el = renameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [renamingSheetId]);

  // Bind to the sheet id created at tab-open time. Never create on mount.
  useEffect(() => {
    const existing =
      typeof boundSheetId === 'string' && boundSheetId.trim()
        ? boundSheetId.trim()
        : null;
    if (existing) {
      setActiveSheetId((prev) => (prev === existing ? prev : existing));
      return;
    }
    if (!bindingEnabled) {
      setActiveSheetId((prev) => prev || 'main');
      return;
    }
    // Bound panel without a sheet id (legacy / failed open) — do not invent one here.
    setLoadError(t('table.createSheetFailed'));
    setLoading(false);
  }, [boundSheetId, bindingEnabled, t]);

  useEffect(() => {
    if (!activeSheetId) return;
    void load(activeSheetId, true);
    const es = new EventSource('/api/table/stream');
    es.onopen = () => {
      // (re)connected — one full resync catches anything missed while disconnected.
      void load(activeSheetId, false);
    };
    es.onmessage = (ev) => {
      let e: TableEvent;
      try {
        e = JSON.parse(ev.data) as TableEvent;
      } catch {
        return;
      }
      if (e.type === 'sheetsChange') {
        // Only refresh tab metadata — do NOT full-reload rows (large sheets time out
        // and surface as a spurious load/delete failure).
        void fetchSheetList(threadId)
          .then((nextSheets) => {
            setSheets(nextSheets);
            if (nextSheets.some((s) => s.id === activeSheetId)) return;
            const fallback = nextSheets[0];
            if (!fallback) return;
            resetSheetUiState();
            setActiveSheetId(fallback.id);
            setLoading(true);
            onBoundSheetRef.current?.(fallback.id, { title: fallback.name });
          })
          .catch(() => {
            /* ignore — next user action will resync */
          });
        return;
      }
      if (e.sheet !== activeSheetId) return;
      if (e.type === 'rowUpsert') {
        const incoming = e.row;
        const key = rowKey(incoming);
        setRows((prev) => {
          const idx = prev.findIndex((r) => rowKey(r) === key);
          if (idx === -1) return [...prev, incoming];
          const next = prev.slice();
          next[idx] = incoming;
          return next;
        });
      } else if (e.type === 'rowsDelete') {
        const drop = new Set(e.keys);
        setRows((prev) => prev.filter((r) => !drop.has(rowKey(r))));
      } else if (e.type === 'sheetReplace' || e.type === 'schemaChange') {
        void load(activeSheetId, false);
      }
    };
    return () => es.close();
  }, [activeSheetId, load, resetSheetUiState, threadId]);

  const matchedRows = useMemo(() => {
    const queryColumns = columnDefs.map((c) => ({ key: c.key, name: c.name, type: c.type }));
    const q = filters.query.trim();
    let filtered: TableRow[];
    if (!q) {
      filtered = [...rows];
    } else if (selectedColumnKey) {
      // Column header selected → scope search to that column (contains).
      filtered = applyColumnFilters(rows, queryColumns, [
        { column: selectedColumnKey, op: 'contains', value: q },
      ]);
    } else {
      filtered = applyTextQuery(rows, q);
    }
    const sort = sortColumns[0];
    if (!sort) return filtered;
    return sortRows(
      filtered,
      queryColumns,
      sort.columnKey,
      sort.direction === 'DESC' ? 'desc' : 'asc',
    );
  }, [rows, filters, selectedColumnKey, sortColumns, columnDefs]);

  const displayRows = useMemo(() => {
    if (matchedRows.length <= SOFT_ROW_RENDER_CAP) return matchedRows;
    return matchedRows.slice(0, SOFT_ROW_RENDER_CAP);
  }, [matchedRows]);

  const toggleSort = useCallback((columnKey: string) => {
    setSortColumns((prev) => {
      const idx = prev.findIndex((s) => s.columnKey === columnKey);
      if (idx === -1) return [{ columnKey, direction: 'ASC' }];
      const current = prev[idx]!;
      if (current.direction === 'ASC') return [{ columnKey, direction: 'DESC' }];
      return [];
    });
  }, []);

  const applyRowSelectionRange = useCallback(
    (fromIdx: number, toIdx: number, checked: boolean, base: ReadonlySet<string>) => {
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      const next = new Set(base);
      for (let i = start; i <= end; i++) {
        const row = displayRows[i];
        if (!row) continue;
        const key = rowKey(row);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    },
    [displayRows],
  );

  const handleRowSelect = useCallback(
    (rowIdx: number, key: string, checked: boolean, shiftKey: boolean) => {
      clearColumnSelection();
      setSelectedRows((prev) => {
        if (
          shiftKey &&
          selectionAnchorRef.current !== null &&
          selectionAnchorRef.current !== rowIdx
        ) {
          return applyRowSelectionRange(selectionAnchorRef.current, rowIdx, checked, prev);
        }
        const next = new Set(prev);
        if (checked) next.add(key);
        else next.delete(key);
        return next;
      });
      selectionAnchorRef.current = rowIdx;
    },
    [applyRowSelectionRange, clearColumnSelection],
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      clearColumnSelection();
      setSelectedRows(checked ? new Set(displayRows.map((r) => rowKey(r))) : new Set());
      selectionAnchorRef.current = null;
    },
    [displayRows, clearColumnSelection],
  );

  const onCellClick = useCallback(
    (args: CellMouseArgs<TableRow>, event: CellMouseEvent) => {
      if (args.column.key === SELECT_COL_KEY) return;
      clearColumnSelection();
      const { rowIdx, row } = args;
      if (event.shiftKey && selectionAnchorRef.current !== null) {
        setSelectedRows((prev) =>
          applyRowSelectionRange(selectionAnchorRef.current!, rowIdx, true, prev),
        );
        event.preventGridDefault();
        return;
      }
      selectionAnchorRef.current = rowIdx;
      if (args.column.key === '__rowNum__') {
        handleRowSelect(rowIdx, rowKey(row), !selectedRows.has(rowKey(row)), false);
        event.preventGridDefault();
      }
    },
    [applyRowSelectionRange, clearColumnSelection, handleRowSelect, selectedRows],
  );

  const totals = useMemo<TableGridTotals>(
    () => ({
      shownCount: displayRows.length,
      matchedCount: matchedRows.length,
      totalCount: rows.length,
      selectedCount: selectedRows.size,
      capped: matchedRows.length > SOFT_ROW_RENDER_CAP,
    }),
    [displayRows.length, matchedRows.length, rows.length, selectedRows.size],
  );

  const commitRows = useCallback(
    (merged: TableRow[], touchedKeys: ReadonlySet<string>, previous: TableRow[]) => {
      lastSerialized.current = JSON.stringify(merged);
      editingUntil.current = Date.now() + 3000;
      setRows(merged);
      const touched = merged.filter((row) => touchedKeys.has(rowKey(row)));
      if (touched.length === 0) return;
      void (async () => {
        const result = await patchRows(activeSheetId, touched, threadId);
        if (!result.ok) {
          lastSerialized.current = JSON.stringify(previous);
          setRows(previous);
          showToast(result.message ?? t('table.saveFailed'), 'error');
        }
      })();
    },
    [activeSheetId, showToast, t, threadId],
  );

  const pushHistory = useCallback((batch: HistoryBatch) => {
    if (batch.length === 0) return;
    setUndoStack((prev) => {
      const next = [...prev, batch];
      if (next.length > HISTORY_LIMIT) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  const applyHistory = useCallback(
    (batch: HistoryBatch, mode: 'undo' | 'redo') => {
      isApplyingHistory.current = true;
      setRows((current) => {
        const previous = current;
        const merged = applyHistoryBatch(current, batch, mode);
        lastSerialized.current = JSON.stringify(merged);
        editingUntil.current = Date.now() + 3000;
        const touched = new Set(batch.map((e) => e.rowKey));
        const touchedRows = merged.filter((row) => touched.has(rowKey(row)));
        void (async () => {
          const result = await patchRows(activeSheetId, touchedRows, threadId);
          if (!result.ok) {
            lastSerialized.current = JSON.stringify(previous);
            setRows(previous);
            showToast(result.message ?? t('table.saveFailed'), 'error');
          }
        })();
        return merged;
      });
      queueMicrotask(() => {
        isApplyingHistory.current = false;
      });
    },
    [activeSheetId, showToast, t, threadId],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((undo) => {
      const batch = undo.at(-1);
      if (!batch) return undo;
      setRedoStack((redo) => [...redo, batch]);
      applyHistory(batch, 'undo');
      return undo.slice(0, -1);
    });
  }, [applyHistory]);

  const handleRedo = useCallback(() => {
    setRedoStack((redo) => {
      const batch = redo.at(-1);
      if (!batch) return redo;
      setUndoStack((undo) => {
        const next = [...undo, batch];
        if (next.length > HISTORY_LIMIT) next.shift();
        return next;
      });
      applyHistory(batch, 'redo');
      return redo.slice(0, -1);
    });
  }, [applyHistory]);

  const onRowsChange = useCallback(
    (next: TableRow[], data: RowsChangeData<TableRow>) => {
      const edits = isApplyingHistory.current
        ? []
        : collectEdits(displayRows, next, data.column.key, data.indexes, editableKeys);
      if (edits.length > 0) pushHistory(edits);

      const previous = rows;
      const byKey = new Map(next.map((r) => [rowKey(r), r]));
      const merged = rows.map((r) => byKey.get(rowKey(r)) ?? r);
      const touched = new Set(
        edits.length > 0
          ? edits.map((e) => e.rowKey)
          : data.indexes
              .map((idx) => (next[idx] ? rowKey(next[idx]) : null))
              .filter((k): k is string => k != null),
      );
      commitRows(merged, touched, previous);
    },
    [commitRows, displayRows, editableKeys, pushHistory, rows],
  );

  const onCellKeyDown = useCallback(
    (_args: CellKeyDownArgs<TableRow>, event: CellKeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventGridDefault();
        handleUndo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventGridDefault();
        handleRedo();
      }
    },
    [handleRedo, handleUndo],
  );

  const onCellCopy = useCallback(
    (args: CellCopyArgs<TableRow>, event: React.ClipboardEvent) => {
      if (window.getSelection()?.isCollapsed === false) return;
      const { row, column } = args;
      if (
        column.key === SELECT_COLUMN_KEY ||
        column.key === '__rowNum__'
      ) {
        return;
      }
      event.clipboardData.setData('text/plain', cellTextValue(row, column.key));
      event.preventDefault();
    },
    [],
  );

  const onCellPaste = useMemo(() => makeOnCellPaste(editableKeys), [editableKeys]);

  const visibleRowKeys = useMemo(
    () => displayRows.map((r) => rowKey(r)),
    [displayRows],
  );

  const rowSelectionCtx = useMemo<RowSelectionCtx>(
    () => ({
      selectedRows,
      visibleRowKeys,
      onRowSelect: handleRowSelect,
      onSelectAll: handleSelectAll,
    }),
    [handleRowSelect, handleSelectAll, selectedRows, visibleRowKeys],
  );

  const columnSelectionCtx = useMemo<ColumnSelectionCtx>(
    () => ({ selectedKey: selectedColumnKey, select: selectColumn, toggleSort }),
    [selectColumn, selectedColumnKey, toggleSort],
  );

  const dataColumns = useMemo(
    () => columnDefs.map((def) => buildDataColumn(def, displayRows)),
    [columnDefs, displayRows],
  );

  const columns = useMemo<Column<TableRow>[]>(
    () => [
      {
        key: '__rowNum__',
        name: '#',
        // localized via aria where needed; '#' is universal
        width: 44,
        minWidth: 44,
        frozen: true,
        sortable: false,
        resizable: false,
        renderCell: ({ rowIdx }) => (
          <span className="text-muted-foreground block w-full text-center tabular-nums">
            {rowIdx + 1}
          </span>
        ),
      },
      {
        key: SELECT_COL_KEY,
        name: '',
        width: 35,
        minWidth: 35,
        maxWidth: 35,
        frozen: true,
        sortable: false,
        resizable: false,
        renderHeaderCell: ({ tabIndex }: RenderHeaderCellProps<TableRow>) => (
          <SelectAllHeader tabIndex={tabIndex} />
        ),
        renderCell: ({ row, rowIdx, tabIndex }) => (
          <SelectRowCell
            tabIndex={tabIndex}
            rowKeyValue={rowKey(row)}
            rowIdx={rowIdx}
          />
        ),
      },
      ...dataColumns,
    ],
    [dataColumns],
  );

  const handleAddRow = async () => {
    const res = await fetch('/api/table/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: activeSheetId,
        ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: TableRow[] };
    if (data.ok && data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
  };

  const handleDeleteRows = async () => {
    if (selectedRows.size === 0) return;
    const res = await fetch('/api/table/rows', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: activeSheetId,
        row_keys: [...selectedRows],
        ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: TableRow[] };
    if (!data.ok || !data.rows) return;
    resetSheetUiState();
    editingUntil.current = Date.now() + 3000;
    lastSerialized.current = JSON.stringify(data.rows);
    setRows(data.rows);
  };

  const openAddColumnDialog = useCallback(() => {
    setNewColumnName('');
    setAddColumnOpen(true);
  }, []);

  const submitAddColumn = async () => {
    const name = newColumnName.trim();
    if (!name) return;
    setAddingColumn(true);
    try {
      const res = await fetch('/api/table/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: activeSheetId,
          name,
          ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        columns?: TableColumnDef[];
        rows?: TableRow[];
      };
      if (!data.ok) return;
      if (data.columns) setColumnDefs(data.columns);
      if (data.rows) {
        editingUntil.current = Date.now() + 3000;
        lastSerialized.current = JSON.stringify(data.rows);
        setRows(data.rows);
      }
      setAddColumnOpen(false);
      setNewColumnName('');
    } finally {
      setAddingColumn(false);
    }
  };

  const handleDeleteColumn = async () => {
    if (!selectedColumnKey) return;
    const col = columnDefs.find((c) => c.key === selectedColumnKey);
    if (!col?.deletable) {
      showToast(t('table.columnNotDeletable'), 'error');
      return;
    }
    const res = await fetch('/api/table/columns', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: activeSheetId,
        key: selectedColumnKey,
        ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      columns?: TableColumnDef[];
      rows?: TableRow[];
    };
    if (!data.ok) return;
    if (data.columns) setColumnDefs(data.columns);
    if (data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
    setSelectedColumnKey(null);
  };

  const rowActionDelete = selectedRows.size > 0;
  const selectedColumn = columnDefs.find((c) => c.key === selectedColumnKey);
  const columnSelected = Boolean(selectedColumnKey && selectedColumn);

  const handleRowAction = () => {
    if (rowActionDelete) void handleDeleteRows();
    else void handleAddRow();
  };

  const handleColumnAction = () => {
    if (columnSelected) void handleDeleteColumn();
    else openAddColumnDialog();
  };

  const activeSheetName =
    sheets.find((s) => s.id === activeSheetId)?.name ?? activeSheetId;

  const handleExportExcel = () => {
    void (async () => {
      try {
        const { path } = await exportTableToExcel(activeSheetName, columnDefs, rows);
        showToast(t('table.exportSuccess', { path }), 'success');
      } catch (e: unknown) {
        showToast(e instanceof Error ? e.message : t('table.importFailed'), 'error');
      }
    })();
  };

  const handleImportFileSelected = (file: File) => {
    setPendingImportFile(file);
    setImportConfirmOpen(true);
  };

  const cancelImport = useCallback(() => {
    setImportConfirmOpen(false);
    setPendingImportFile(null);
    resetImportInput();
  }, [resetImportInput]);

  const handleImportFile = async (file: File) => {
    try {
      const { rows: importedRows, columnNames } = await parseTableExcelFile(file);
      if (columnNames.length === 0 || importedRows.length === 0) {
        showToast(t('table.importEmpty'), 'error');
        return;
      }
      const res = await fetch('/api/table/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: activeSheetId,
          column_names: columnNames,
          rows: importedRows,
          ...(threadId?.trim() ? { threadId: threadId.trim() } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        columns?: TableColumnDef[];
        rows?: TableRow[];
      };
      if (!res.ok || !data.ok) {
        showToast(data.message ?? t('table.importFailed'), 'error');
        return;
      }
      resetSheetUiState();
      if (data.columns) setColumnDefs(data.columns);
      if (data.rows) {
        editingUntil.current = Date.now() + 5000;
        lastSerialized.current = JSON.stringify(data.rows);
        setRows(data.rows);
      }
      showToast(t('table.importSuccess', { count: data.rows?.length ?? importedRows.length }), 'success');
      setImportConfirmOpen(false);
      setPendingImportFile(null);
      resetImportInput();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.importFailed'), 'error');
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = () => {
    const file = pendingImportFile;
    if (!file || importing) return;
    // Paint loading UI before Excel parse blocks the main thread.
    setImporting(true);
    void (async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      await handleImportFile(file);
    })();
  };

  const hasActiveFilters = filters.query.trim() !== '';

  const filterPlaceholder = selectedColumn
    ? t('table.filterColumnPlaceholder', { name: selectedColumn.name })
    : t('table.filterPlaceholder');

  const visibleSheets = sheets;

  // Sheet tabs + toolbar stay mounted; loading / errors only replace the grid body.

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {toast ? (
        <div
          role="status"
          className={cn(
            'absolute bottom-3 left-1/2 z-50 max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-md px-3 py-2 text-center text-xs shadow-md',
            toast.variant === 'success'
              ? 'bg-primary text-primary-foreground'
              : 'bg-destructive text-white',
          )}
        >
          {toast.message}
        </div>
      ) : null}
      {/* Sheet tabs — top */}
      <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1',
            'overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {visibleSheets.map((sheet) => {
            const active = activeSheetId === sheet.id;
            const renaming = renamingSheetId === sheet.id;
            return (
              <div
                key={sheet.id}
                className={cn(
                  'group/tab flex shrink-0 items-center rounded-md text-xs transition-colors',
                  '[&:hover_.sheet-tab-close]:ml-0.5 [&:hover_.sheet-tab-close]:max-w-5 [&:hover_.sheet-tab-close]:opacity-100',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {renaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameDraft}
                    size={Math.max(renameDraft.length, 1)}
                    aria-label={t('table.renameSheet')}
                    disabled={renamingSheet}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onBlur={() => {
                      void commitRenameSheet();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitRenameSheet();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRenameSheet();
                      }
                    }}
                    className={cn(
                      'sheet-tab-label w-auto max-w-[10rem] min-w-0 rounded-md border-0 bg-transparent py-1 pl-2.5 pr-1 outline-none',
                      active
                        ? 'text-primary-foreground placeholder:text-primary-foreground/60'
                        : 'text-foreground',
                    )}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => switchSheet(sheet.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      beginRenameSheet(sheet);
                    }}
                    title={t('table.renameSheet')}
                    className="sheet-tab-label py-1 pl-2.5 pr-1 transition-[padding] duration-150"
                  >
                    {sheet.name}
                  </button>
                )}
                {(bindingEnabled || visibleSheets.length > 1) && !renaming ? (
                  <button
                    type="button"
                    aria-label={t('table.deleteSheet', { name: sheet.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSheetTarget(sheet);
                    }}
                    className={cn(
                      'sheet-tab-close mr-1 overflow-hidden rounded-md p-0.5 transition-all duration-150',
                      'max-w-0 opacity-0',
                      active ? 'hover:bg-primary-foreground/20' : 'hover:bg-foreground/10',
                    )}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          aria-label={t('table.newSheet')}
          onClick={openAddSheetDialog}
          className="text-muted-foreground hover:bg-muted hover:text-foreground ml-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* Toolbar + filters */}
      <div className="border-border shrink-0 space-y-2 border-b px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', rowActionDelete && 'text-destructive hover:text-destructive')}
            onClick={handleRowAction}
            disabled={loading}
          >
            {rowActionDelete ? <Minus className="size-3" /> : <Plus className="size-3" />}
            {rowActionDelete && selectedRows.size > 1
              ? t('table.rowsN', { count: selectedRows.size })
              : t('table.rows')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', columnSelected && 'text-destructive hover:text-destructive')}
            onClick={handleColumnAction}
            disabled={loading}
          >
            {columnSelected ? <Minus className="size-3" /> : <Plus className="size-3" />}
            {t('table.columns')}
          </Button>
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={importing || loading}
          >
            <label className={cn((importing || loading) && 'pointer-events-none opacity-50')}>
              <Upload className="size-3" />
              {importing ? t('table.importing') : t('table.import')}
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={importing || loading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFileSelected(file);
                }}
              />
            </label>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleExportExcel}
            disabled={loading}
          >
            <Download className="size-3" />
            {t('table.export')}
          </Button>
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <input
            type="search"
            placeholder={filterPlaceholder}
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            disabled={loading}
            className="bg-background border-input h-7 min-w-[8rem] flex-1 rounded-md border px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          {hasActiveFilters ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              {t('table.clear')}
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('table.undo')}
              disabled={undoStack.length === 0 || loading}
              onClick={handleUndo}
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('table.redo')}
              disabled={redoStack.length === 0 || loading}
              onClick={handleRedo}
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          {t('table.loading')}
        </div>
      ) : loadError && rows.length === 0 && columnDefs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-muted-foreground text-sm">
            {t('table.loadError', { error: loadError })}
          </p>
          <button
            type="button"
            className="text-foreground border-border hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              void load(activeSheetId, true);
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : displayRows.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
          <span>
            {columnDefs.length === 0
              ? t('table.noColumns')
              : rows.length === 0
                ? t('table.noData')
                : t('table.noMatch')}
          </span>
          {columnDefs.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={openAddColumnDialog}>
              {t('table.addFirstColumn')}
            </Button>
          ) : rows.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleAddRow()}>
              {t('table.addFirstRow')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <RowSelectionContext.Provider value={rowSelectionCtx}>
            <ColumnSelectionContext.Provider value={columnSelectionCtx}>
              <DataGrid
                className="table-grid rdg-light min-h-0 flex-1 text-sm"
                style={{ blockSize: '100%' }}
                aria-label={t('table.ariaGrid')}
                columns={columns}
                rows={displayRows}
                onRowsChange={onRowsChange}
                onCellClick={onCellClick}
                onCellKeyDown={onCellKeyDown}
                onCellCopy={onCellCopy}
                onCellPaste={onCellPaste}
                rowKeyGetter={(row) => rowKey(row)}
                rowClass={(row) => (selectedRows.has(rowKey(row)) ? 'bg-primary/8' : undefined)}
                sortColumns={sortColumns}
                onSortColumnsChange={setSortColumns}
                defaultColumnOptions={{ resizable: true, sortable: true }}
              />
            </ColumnSelectionContext.Provider>
          </RowSelectionContext.Provider>
          <TableGridFooter totals={totals} />
        </div>
      )}

      <Dialog
        open={addSheetOpen}
        onOpenChange={(open) => {
          if (addingSheet) return;
          setAddSheetOpen(open);
          if (!open) setNewSheetName('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('table.newSheet')}</DialogTitle>
            <DialogDescription>{t('table.newSheetName')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newSheetName}
            onChange={(e) => setNewSheetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSheetName.trim()) void submitAddSheet();
            }}
            placeholder={t('table.newSheetName')}
          />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={addingSheet}
              onClick={() => {
                setAddSheetOpen(false);
                setNewSheetName('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={addingSheet || !newSheetName.trim()}
              onClick={() => void submitAddSheet()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addColumnOpen}
        onOpenChange={(open) => {
          if (addingColumn) return;
          setAddColumnOpen(open);
          if (!open) setNewColumnName('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('table.addFirstColumn')}</DialogTitle>
            <DialogDescription>{t('table.newColumnName')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newColumnName.trim()) void submitAddColumn();
            }}
            placeholder={t('table.newColumnName')}
          />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={addingColumn}
              onClick={() => {
                setAddColumnOpen(false);
                setNewColumnName('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={addingColumn || !newColumnName.trim()}
              onClick={() => void submitAddColumn()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteSheetTarget != null}
        onOpenChange={(open) => {
          if (!open && !deletingSheet) setDeleteSheetTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteSheetTarget
                ? t('table.deleteSheet', { name: deleteSheetTarget.name })
                : ''}
            </DialogTitle>
            <DialogDescription>{t('table.confirmDeleteSheet')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deletingSheet}
              onClick={() => setDeleteSheetTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSheet}
              onClick={() => void confirmDeleteSheet()}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importConfirmOpen}
        onOpenChange={(open) => {
          if (importing) return;
          if (!open) cancelImport();
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={!importing}
          onPointerDownOutside={(e) => {
            if (importing) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (importing) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('table.import')}</DialogTitle>
            <DialogDescription>
              {importing ? t('table.importing') : t('table.confirmImport')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={importing} onClick={cancelImport}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={importing || !pendingImportFile} onClick={confirmImport}>
              {importing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('table.importing')}
                </>
              ) : (
                t('table.import')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
