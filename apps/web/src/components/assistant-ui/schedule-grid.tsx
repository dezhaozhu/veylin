import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Minus, Redo2, Undo2, Upload, Download, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { exportScheduleToExcel, parseScheduleExcelFile } from '@/lib/schedule-excel';

type ScheduleStatus = 'normal' | 'tight' | 'overdue';
type ScheduleColumnType = 'text' | 'number' | 'status';

type ScheduleRow = Record<string, string | number> & { order_no: string; row_id?: string };

function rowKey(row: ScheduleRow): string {
  return String(row.row_id ?? row.order_no);
}

interface ScheduleColumnDef {
  key: string;
  name: string;
  width: number;
  type: ScheduleColumnType;
  frozen?: boolean;
  deletable: boolean;
}

interface ScheduleSheet {
  id: string;
  name: string;
  builtin: boolean;
}

interface ScheduleGridTotals {
  rowCount: number;
  selectedCount: number;
}

type FilterState = {
  query: string;
};

const STATUS_META: Record<ScheduleStatus, { labelKey: string; className: string }> = {
  normal: { labelKey: 'sched.status.normal', className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' },
  tight: { labelKey: 'sched.status.tight', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  overdue: { labelKey: 'sched.status.overdue', className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
};

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
  sheets?: ScheduleSheet[];
  columns?: ScheduleColumnDef[];
  rows?: ScheduleRow[];
};

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(i18n.t('sched.noResponse', { status: res.status }));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(i18n.t('sched.invalidResponse', { status: res.status }));
  }
}

async function fetchSchedule(sheetId: string): Promise<SchedulePayload> {
  const res = await fetch(`/api/schedule?sheet=${encodeURIComponent(sheetId)}`);
  const data = await readJsonResponse<SchedulePayload>(res);
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
}

async function patchRow(sheetId: string, row: ScheduleRow): Promise<boolean> {
  try {
    const res = await fetch('/api/schedule', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: sheetId, row_key: rowKey(row), ...row }),
    });
    const data = (await res.json()) as { ok?: boolean };
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}

function applyHistoryBatch(
  allRows: ScheduleRow[],
  batch: HistoryBatch,
  mode: 'undo' | 'redo',
): ScheduleRow[] {
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
  beforeRows: readonly ScheduleRow[],
  afterRows: readonly ScheduleRow[],
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

function applyFilters(rows: ScheduleRow[], filters: FilterState): ScheduleRow[] {
  const q = filters.query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
  );
}

function compareScheduleValues(
  a: string | number | undefined,
  b: string | number | undefined,
  type: ScheduleColumnType,
): number {
  const aEmpty = a === undefined || a === '';
  const bEmpty = b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  if (type === 'number') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}

function sortScheduleRows(
  rows: ScheduleRow[],
  sortColumns: readonly SortColumn[],
  columnDefs: ScheduleColumnDef[],
): ScheduleRow[] {
  if (sortColumns.length === 0) return rows;
  const { columnKey, direction } = sortColumns[0]!;
  const colDef = columnDefs.find((c) => c.key === columnKey);
  const type = colDef?.type ?? 'text';
  return [...rows].sort((a, b) => {
    const cmp = compareScheduleValues(a[columnKey], b[columnKey], type);
    return direction === 'ASC' ? cmp : -cmp;
  });
}

function cellTextValue(row: ScheduleRow, columnKey: string): string {
  const value = row[columnKey];
  if (value === undefined || value === null) return '';
  return String(value);
}

function ScheduleGridFooter({ totals }: { totals: ScheduleGridTotals }) {
  const { t } = useTranslation();
  return (
    <div
      className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-foreground font-medium">{t('sched.footerTotal', { count: totals.rowCount })}</span>
      {totals.selectedCount > 0 ? <span>{t('sched.footerSelected', { count: totals.selectedCount })}</span> : null}
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
        aria-label={t('sched.sortBy', { name })}
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
      aria-label={t('sched.selectAll')}
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
      aria-label={t('sched.selectRow')}
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
  const meta = STATUS_META[status as ScheduleStatus] ?? STATUS_META.normal;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        meta.className,
      )}
    >
      {t(meta.labelKey)}
    </span>
  );
}

function StatusEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<ScheduleRow>) {
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
      <option value="normal">{t('sched.status.normal')}</option>
      <option value="tight">{t('sched.status.tight')}</option>
      <option value="overdue">{t('sched.status.overdue')}</option>
    </select>
  );
}

function NumberEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<ScheduleRow>) {
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

function CenteredTextEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<ScheduleRow>) {
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

function cellDisplayValue(row: ScheduleRow, key: string): string {
  const value = row[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

function buildDataColumn(def: ScheduleColumnDef): Column<ScheduleRow> {
  const headerCell = ({ tabIndex, sortDirection }: RenderHeaderCellProps<ScheduleRow>) => (
    <SelectableColumnHeader
      columnKey={def.key}
      name={def.name}
      tabIndex={tabIndex}
      sortDirection={sortDirection}
    />
  );
  const base: Pick<Column<ScheduleRow>, 'key' | 'name' | 'width' | 'frozen' | 'sortable' | 'renderHeaderCell'> = {
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
    return {
      ...base,
      renderCell: ({ row }: RenderCellProps<ScheduleRow>) => (
        <div className="flex w-full justify-center px-2">
          <StatusBadge status={String(row[def.key] ?? '')} />
        </div>
      ),
      renderEditCell: StatusEditor,
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
  return (args: CellPasteArgs<ScheduleRow>, event: React.ClipboardEvent): ScheduleRow => {
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

export function ScheduleGrid() {
  const { t } = useTranslation();
  const [sheets, setSheets] = useState<ScheduleSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState('main');
  const [columnDefs, setColumnDefs] = useState<ScheduleColumnDef[]>([]);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const columnKeys = useMemo(() => new Set(columnDefs.map((c) => c.key)), [columnDefs]);
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

  const applyPayload = useCallback((data: SchedulePayload, initial: boolean) => {
    if (data.sheets?.length) setSheets(data.sheets);
    if (data.columns) setColumnDefs(data.columns);
    const next = data.rows ?? [];
    if (initial) setLoading(false);
    if (Date.now() < editingUntil.current) return;
    const serialized = JSON.stringify(next);
    if (serialized === lastSerialized.current) return;
    lastSerialized.current = serialized;
    setRows(next);
  }, []);

  const load = useCallback(
    async (sheetId: string, initial: boolean) => {
      try {
        const data = await fetchSchedule(sheetId);
        applyPayload(data, initial);
      } catch (e: unknown) {
        if (initial) {
          setError(e instanceof Error ? e.message : t('sched.loadFailedGeneric'));
          setLoading(false);
        }
      }
    },
    [applyPayload, t],
  );

  const switchSheet = useCallback(
    (sheetId: string) => {
      if (sheetId === activeSheetId) return;
      resetSheetUiState();
      setActiveSheetId(sheetId);
      setLoading(true);
      setError(null);
    },
    [activeSheetId, resetSheetUiState],
  );

  useEffect(() => {
    void load(activeSheetId, true);
    const t = window.setInterval(() => void load(activeSheetId, false), 4000);
    return () => window.clearInterval(t);
  }, [activeSheetId, load]);

  const filteredRows = useMemo(() => {
    const filtered = applyFilters(rows, filters);
    return sortScheduleRows(filtered, sortColumns, columnDefs);
  }, [rows, filters, sortColumns, columnDefs]);

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
        const row = filteredRows[i];
        if (!row) continue;
        const key = rowKey(row);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    },
    [filteredRows],
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
      setSelectedRows(checked ? new Set(filteredRows.map((r) => rowKey(r))) : new Set());
      selectionAnchorRef.current = null;
    },
    [filteredRows, clearColumnSelection],
  );

  const onCellClick = useCallback(
    (args: CellMouseArgs<ScheduleRow>, event: CellMouseEvent) => {
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

  const totals = useMemo<ScheduleGridTotals>(
    () => ({
      rowCount: filteredRows.length,
      selectedCount: selectedRows.size,
    }),
    [filteredRows.length, selectedRows.size],
  );

  const commitRows = useCallback(
    (merged: ScheduleRow[], touchedKeys: ReadonlySet<string>) => {
      lastSerialized.current = JSON.stringify(merged);
      editingUntil.current = Date.now() + 3000;
      setRows(merged);
      for (const row of merged) {
        if (touchedKeys.has(rowKey(row))) void patchRow(activeSheetId, row);
      }
    },
    [activeSheetId],
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
        const merged = applyHistoryBatch(current, batch, mode);
        lastSerialized.current = JSON.stringify(merged);
        editingUntil.current = Date.now() + 3000;
        const touched = new Set(batch.map((e) => e.rowKey));
        for (const row of merged) {
          if (touched.has(rowKey(row))) void patchRow(activeSheetId, row);
        }
        return merged;
      });
      queueMicrotask(() => {
        isApplyingHistory.current = false;
      });
    },
    [activeSheetId],
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
    (next: ScheduleRow[], data: RowsChangeData<ScheduleRow>) => {
      const edits = isApplyingHistory.current
        ? []
        : collectEdits(filteredRows, next, data.column.key, data.indexes, editableKeys);
      if (edits.length > 0) pushHistory(edits);

      const byKey = new Map(next.map((r) => [rowKey(r), r]));
      const merged = rows.map((r) => byKey.get(rowKey(r)) ?? r);
      const touched = new Set(
        edits.length > 0
          ? edits.map((e) => e.rowKey)
          : data.indexes
              .map((idx) => (next[idx] ? rowKey(next[idx]) : null))
              .filter((k): k is string => k != null),
      );
      commitRows(merged, touched);
    },
    [commitRows, editableKeys, filteredRows, pushHistory, rows],
  );

  const onCellKeyDown = useCallback(
    (_args: CellKeyDownArgs<ScheduleRow>, event: CellKeyboardEvent) => {
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
    (args: CellCopyArgs<ScheduleRow>, event: React.ClipboardEvent) => {
      if (window.getSelection()?.isCollapsed === false) return;
      const { row, column } = args;
      if (
        column.key === SELECT_COLUMN_KEY ||
        column.key === '__rowNum__' ||
        column.key === 'order_no'
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
    () => filteredRows.map((r) => rowKey(r)),
    [filteredRows],
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
    () => columnDefs.map((def) => buildDataColumn(def)),
    [columnDefs],
  );

  const columns = useMemo<Column<ScheduleRow>[]>(
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
        renderHeaderCell: ({ tabIndex }: RenderHeaderCellProps<ScheduleRow>) => (
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

  const handleAddSheet = async () => {
    const name = window.prompt(t('sched.newSheetName'));
    if (!name?.trim()) return;
    const res = await fetch('/api/schedule/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = (await res.json()) as { ok?: boolean; sheet?: ScheduleSheet; sheets?: ScheduleSheet[] };
    if (!data.ok || !data.sheet) return;
    if (data.sheets) setSheets(data.sheets);
    switchSheet(data.sheet.id);
  };

  const handleDeleteSheet = async (sheetId: string) => {
    if (!window.confirm(t('sched.confirmDeleteSheet'))) return;
    const res = await fetch(`/api/schedule/sheets/${encodeURIComponent(sheetId)}`, {
      method: 'DELETE',
    });
    const data = (await res.json()) as {
      ok?: boolean;
      sheets?: ScheduleSheet[];
      nextSheet?: string;
    };
    if (!data.ok) return;
    if (data.sheets) setSheets(data.sheets);
    if (data.nextSheet) switchSheet(data.nextSheet);
  };

  const handleAddRow = async () => {
    const res = await fetch('/api/schedule/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: ScheduleRow[] };
    if (data.ok && data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
  };

  const handleDeleteRows = async () => {
    if (selectedRows.size === 0) return;
    const res = await fetch('/api/schedule/rows', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId, row_keys: [...selectedRows] }),
    });
    const data = (await res.json()) as { ok?: boolean; rows?: ScheduleRow[] };
    if (!data.ok || !data.rows) return;
    resetSheetUiState();
    editingUntil.current = Date.now() + 3000;
    lastSerialized.current = JSON.stringify(data.rows);
    setRows(data.rows);
  };

  const handleAddColumn = async () => {
    const name = window.prompt(t('sched.newColumnName'));
    if (!name?.trim()) return;
    const res = await fetch('/api/schedule/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId, name: name.trim() }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      columns?: ScheduleColumnDef[];
      rows?: ScheduleRow[];
    };
    if (!data.ok) return;
    if (data.columns) setColumnDefs(data.columns);
    if (data.rows) {
      editingUntil.current = Date.now() + 3000;
      lastSerialized.current = JSON.stringify(data.rows);
      setRows(data.rows);
    }
  };

  const handleDeleteColumn = async () => {
    if (!selectedColumnKey) return;
    const col = columnDefs.find((c) => c.key === selectedColumnKey);
    if (!col?.deletable) {
      window.alert(t('sched.columnNotDeletable'));
      return;
    }
    const res = await fetch('/api/schedule/columns', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId, key: selectedColumnKey }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      columns?: ScheduleColumnDef[];
      rows?: ScheduleRow[];
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
    else void handleAddColumn();
  };

  const activeSheetName =
    sheets.find((s) => s.id === activeSheetId)?.name ?? activeSheetId;

  const handleExportExcel = () => {
    exportScheduleToExcel(activeSheetName, columnDefs, rows);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (file: File) => {
    if (!window.confirm(t('sched.confirmImport'))) return;
    setImporting(true);
    try {
      const { rows: importedRows, newColumnNames } = await parseScheduleExcelFile(
        file,
        columnDefs,
      );
      const res = await fetch('/api/schedule/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: activeSheetId,
          rows: importedRows,
          new_column_names: newColumnNames,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        columns?: ScheduleColumnDef[];
        rows?: ScheduleRow[];
      };
      if (!data.ok) {
        window.alert(data.message ?? t('sched.importFailed'));
        return;
      }
      resetSheetUiState();
      if (data.columns) setColumnDefs(data.columns);
      if (data.rows) {
        editingUntil.current = Date.now() + 5000;
        lastSerialized.current = JSON.stringify(data.rows);
        setRows(data.rows);
      }
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : t('sched.importFailed'));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const hasActiveFilters = filters.query.trim() !== '';

  if (loading && rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {t('sched.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive flex h-full items-center justify-center px-4 text-center text-sm">
        {t('sched.loadError', { error })}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sheet tabs — top */}
      <div className="border-border flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
        {sheets.map((sheet) => {
          const active = activeSheetId === sheet.id;
          const canDelete = sheets.length > 1;
          return (
            <div
              key={sheet.id}
              className={cn(
                'flex shrink-0 items-center rounded-md text-xs transition-colors',
                '[&:hover_.sheet-tab-close]:max-w-6 [&:hover_.sheet-tab-close]:p-1 [&:hover_.sheet-tab-close]:opacity-100',
                '[&:hover_.sheet-tab-label]:pr-0.5',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <button
                type="button"
                onClick={() => switchSheet(sheet.id)}
                className="sheet-tab-label py-1 pl-2.5 pr-2.5 transition-[padding] duration-150"
              >
                {sheet.name}
              </button>
              {canDelete ? (
                <button
                  type="button"
                  aria-label={t('sched.deleteSheet', { name: sheet.name })}
                  onClick={() => void handleDeleteSheet(sheet.id)}
                  className={cn(
                    'sheet-tab-close overflow-hidden rounded-r-md transition-all duration-150',
                    'max-w-0 p-0 opacity-0',
                    active
                      ? 'hover:bg-primary-foreground/20'
                      : 'hover:text-destructive',
                  )}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t('sched.newSheet')}
          onClick={() => void handleAddSheet()}
        >
          <Plus className="size-3.5" />
        </Button>
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
          >
            {rowActionDelete ? <Minus className="size-3" /> : <Plus className="size-3" />}
            {rowActionDelete && selectedRows.size > 1
              ? t('sched.rowsN', { count: selectedRows.size })
              : t('sched.rows')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', columnSelected && 'text-destructive hover:text-destructive')}
            onClick={handleColumnAction}
          >
            {columnSelected ? <Minus className="size-3" /> : <Plus className="size-3" />}
            {t('sched.columns')}
          </Button>
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={importing}
            onClick={handleImportClick}
          >
            <Upload className="size-3" />
            {importing ? t('sched.importing') : t('sched.import')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleExportExcel}
          >
            <Download className="size-3" />
            {t('sched.export')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <input
            type="search"
            placeholder={t('sched.filterPlaceholder')}
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            className="bg-background border-input h-7 min-w-[8rem] flex-1 rounded-md border px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          {hasActiveFilters ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              {t('sched.clear')}
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('sched.undo')}
              disabled={undoStack.length === 0}
              onClick={handleUndo}
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('sched.redo')}
              disabled={redoStack.length === 0}
              onClick={handleRedo}
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
          <span>{rows.length === 0 ? t('sched.noData') : t('sched.noMatch')}</span>
          {rows.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleAddRow()}>
              {t('sched.addFirstRow')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <RowSelectionContext.Provider value={rowSelectionCtx}>
            <ColumnSelectionContext.Provider value={columnSelectionCtx}>
              <DataGrid
                className="schedule-grid rdg-light min-h-0 flex-1 text-sm"
                style={{ blockSize: '100%' }}
                aria-label={t('sched.ariaGrid')}
                columns={columns}
                rows={filteredRows}
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
          <ScheduleGridFooter totals={totals} />
        </div>
      )}
    </div>
  );
}
