import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Minus, Redo2, Undo2, Upload, Download, X } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import {
  type ColDef,
  type GetRowIdParams,
  type ValueFormatterParams,
  type ICellRendererParams,
  type CellValueChangedEvent,
  type CellKeyDownEvent,
  type SelectionChangedEvent,
  type IHeaderParams,
  type GridApi,
  type GridReadyEvent,
  themeQuartz,
} from 'ag-grid-community';
import './ag-grid-modules';
import { hasProEntitlement } from '@/lib/ag-grid-license';
import { isAgGridEnterpriseReady } from '@/lib/ag-grid-enterprise-state';
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
import { DEFAULT_TABLE_STATUS_OPTIONS } from '@veylin/shared';

type TableColumnType = 'text' | 'number' | 'status';

type TableRow = Record<string, string | number> & { row_id?: string };

function rowKey(row: TableRow): string {
  return String(row.row_id ?? '');
}

// ── 二三级 master-detail (Pro / AG-Grid Enterprise) ──────────────────────────
// The schedule sheet's 二级 rows expand to their 三级 (设备级) ops, fetched on
// demand from /api/schedule-detail (→ Compass get_workorder_rows). Read-only.
const SCHEDULE_SHEET_ID = 'schedule';

const SCHEDULE_DETAIL_COLUMN_DEFS: ColDef[] = [
  { field: 'op_seq', headerName: '工序号', maxWidth: 90 },
  { field: 'op_name', headerName: '工序' },
  { field: 'op_code', headerName: '工序编码' },
  { field: 'resource_id', headerName: '设备/工作中心' },
  { field: 'status', headerName: '状态' },
  { field: 'wbs', headerName: 'WBS' },
  { field: 'material_code', headerName: '物料' },
  { field: 'planned_start', headerName: '计划开始' },
  { field: 'planned_end', headerName: '计划完成' },
  { field: 'actual_start', headerName: '实际开始' },
  { field: 'actual_end', headerName: '实际完成' },
];

async function fetchScheduleDetail(orderId: unknown, stageCode: unknown): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams();
  if (orderId != null && orderId !== '') qs.set('order_id', String(orderId));
  if (stageCode != null && stageCode !== '') qs.set('stage_code', String(stageCode));
  try {
    const res = await fetch(`/api/schedule-detail?${qs.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { rows?: Record<string, unknown>[] };
    return Array.isArray(data.rows) ? data.rows : [];
  } catch {
    return [];
  }
}

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

interface TableGridTotals {
  rowCount: number;
  selectedCount: number;
}

type FilterState = { query: string };

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

const DEFAULT_EMPTY_COLUMNS: TableColumnDef[] = [];
const DEFAULT_EMPTY_SHEETS: TableSheet[] = [
  { id: 'main', name: 'Sheet 1', builtin: true },
];

function emptySchedulePayload(sheetId: string): SchedulePayload {
  return {
    sheet: sheetId,
    sheets: DEFAULT_EMPTY_SHEETS,
    columns: DEFAULT_EMPTY_COLUMNS,
    rows: [],
  };
}

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

async function fetchSchedule(sheetId: string): Promise<SchedulePayload> {
  const res = await fetch(`/api/table?sheet=${encodeURIComponent(sheetId)}`);
  const data = await readJsonResponse<SchedulePayload>(res);
  if (!res.ok) {
    throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return data;
}

async function patchRow(sheetId: string, row: TableRow): Promise<boolean> {
  try {
    const res = await fetch('/api/table', {
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

// applyFilters: used for React-level pre-filter before passing rowData to AG-Grid
function applyFilters(rows: TableRow[], filters: FilterState): TableRow[] {
  const q = filters.query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)),
  );
}

function compareScheduleValues(
  a: string | number | undefined,
  b: string | number | undefined,
  type: TableColumnType,
): number {
  const aEmpty = a === undefined || a === '';
  const bEmpty = b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  if (type === 'number') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
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
      <span className="text-foreground font-medium">
        {t('table.footerTotal', { count: totals.rowCount })}
      </span>
      {totals.selectedCount > 0 ? (
        <span>{t('table.footerSelected', { count: totals.selectedCount })}</span>
      ) : null}
    </div>
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

// AG-Grid v36 custom header: name click → column selection, chevron → native sort
interface AgColumnHeaderParams extends IHeaderParams<TableRow> {
  columnKey: string;
  onSelect: (key: string | null) => void;
  selectedKeyRef: { current: string | null };
}

function AgColumnHeader(params: AgColumnHeaderParams) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<string | null | undefined>(
    () => params.column.getSort(),
  );

  useEffect(() => {
    const handler = () => setSort(params.column.getSort());
    params.column.addEventListener('sortChanged', handler);
    return () => params.column.removeEventListener('sortChanged', handler);
  }, [params.column]);

  const isSelected = params.selectedKeyRef.current === params.columnKey;

  return (
    <div className="flex size-full min-h-9 items-center justify-center gap-0.5 px-1">
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 truncate px-2 py-1 text-center text-xs outline-none',
          isSelected ? 'text-primary font-medium' : 'hover:bg-muted/60',
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          params.onSelect(isSelected ? null : params.columnKey);
        }}
      >
        {params.displayName}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('table.sortBy', { name: params.displayName })}
        className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          params.progressSort(e.shiftKey);
        }}
      >
        {sort === 'asc' ? (
          <ChevronUp className="size-3.5" />
        ) : sort === 'desc' ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronUp className="size-3.5 opacity-25" />
        )}
      </button>
    </div>
  );
}

export function TableGrid() {
  const { t } = useTranslation();
  const [sheets, setSheets] = useState<TableSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState('main');
  const [columnDefs, setColumnDefs] = useState<TableColumnDef[]>([]);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [undoStack, setUndoStack] = useState<HistoryBatch[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryBatch[]>([]);
  const [selectedColumnKey, setSelectedColumnKey] = useState<string | null>(null);

  const lastSerialized = useRef('');
  const editingUntil = useRef(0);
  const isApplyingHistory = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  // AG-Grid API ref — populated in onGridReady
  const gridApiRef = useRef<GridApi<TableRow> | null>(null);
  // Ref mirror of selectedColumnKey — read by AgColumnHeader on refreshHeader()
  const selectedColumnKeyRef = useRef<string | null>(null);
  // Ref mirror of rows — used in async paste handler to avoid stale closure
  const rowsRef = useRef<TableRow[]>(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToast({ message, variant });
  }, []);

  const resetImportInput = useCallback(() => {
    if (importInputRef.current) importInputRef.current.value = '';
  }, []);

  const editableKeys = useMemo(() => new Set(columnDefs.map((c) => c.key)), [columnDefs]);

  // Column selection — syncs React state + ref, then refreshes AG-Grid headers
  const selectColumn = useCallback((key: string | null) => {
    setSelectedColumnKey(key);
    selectedColumnKeyRef.current = key;
    if (key) {
      setSelectedRows(new Set());
      gridApiRef.current?.deselectAll();
    }
    gridApiRef.current?.refreshHeader();
  }, []);

  const clearColumnSelection = useCallback(() => {
    setSelectedColumnKey(null);
    selectedColumnKeyRef.current = null;
    gridApiRef.current?.refreshHeader();
  }, []);

  const resetSheetUiState = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSelectedRows(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSelectedColumnKey(null);
    selectedColumnKeyRef.current = null;
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
      const attempts = initial ? 6 : 1;
      for (let i = 0; i < attempts; i++) {
        try {
          const data = await fetchSchedule(sheetId);
          applyPayload(data, initial);
          return;
        } catch {
          if (i < attempts - 1) {
            await sleep(400 * (i + 1));
            continue;
          }
          if (initial) {
            applyPayload(emptySchedulePayload(sheetId), true);
          }
        }
      }
    },
    [applyPayload],
  );

  const switchSheet = useCallback(
    (sheetId: string) => {
      if (sheetId === activeSheetId) return;
      resetSheetUiState();
      setActiveSheetId(sheetId);
      setLoading(true);
    },
    [activeSheetId, resetSheetUiState],
  );

  const confirmDeleteSheet = async () => {
    if (!deleteSheetTarget || deletingSheet) return;
    setDeletingSheet(true);
    try {
      const res = await fetch(
        `/api/table/sheets/${encodeURIComponent(deleteSheetTarget.id)}`,
        { method: 'DELETE' },
      );
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
      if (deleteSheetTarget.id === activeSheetId && data.nextSheet) {
        resetSheetUiState();
        setActiveSheetId(data.nextSheet);
        setLoading(true);
      }
      setDeleteSheetTarget(null);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.deleteSheetFailed'), 'error');
    } finally {
      setDeletingSheet(false);
    }
  };

  const suggestNewSheetName = useCallback(() => {
    const used = new Set(sheets.map((s) => s.name));
    let n = sheets.length + 1;
    while (used.has(`Sheet ${n}`)) n++;
    return `Sheet ${n}`;
  }, [sheets]);

  const openAddSheetDialog = useCallback(() => {
    setNewSheetName(suggestNewSheetName());
    setAddSheetOpen(true);
  }, [suggestNewSheetName]);

  const submitAddSheet = async () => {
    const name = newSheetName.trim();
    if (!name) return;
    setAddingSheet(true);
    try {
      const res = await fetch('/api/table/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        message?: string;
        sheet?: TableSheet;
        sheets?: TableSheet[];
      }>(res);
      if (!res.ok || !data.ok || !data.sheet) {
        showToast(data.message ?? t('table.createSheetFailed'), 'error');
        return;
      }
      if (data.sheets) setSheets(data.sheets);
      resetSheetUiState();
      setActiveSheetId(data.sheet.id);
      setLoading(true);
      setAddSheetOpen(false);
      setNewSheetName('');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.createSheetFailed'), 'error');
    } finally {
      setAddingSheet(false);
    }
  };

  useEffect(() => {
    void load(activeSheetId, true);
    const t = window.setInterval(() => void load(activeSheetId, false), 4000);
    return () => window.clearInterval(t);
  }, [activeSheetId, load]);

  // Pre-filter rows in React; AG-Grid handles sort natively via comparator
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const totals = useMemo<TableGridTotals>(
    () => ({
      rowCount: filteredRows.length,
      selectedCount: selectedRows.size,
    }),
    [filteredRows.length, selectedRows.size],
  );

  const commitRows = useCallback(
    (merged: TableRow[], touchedKeys: ReadonlySet<string>) => {
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

  // AG-Grid cell value changed → push undo entry + call commitRows (server writeback)
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<TableRow>) => {
      if (isApplyingHistory.current) return;
      const columnKey = event.colDef.field ?? '';
      if (!columnKey || !editableKeys.has(columnKey)) return;

      const oldValue = event.oldValue ?? '';
      const newValue = event.newValue ?? '';
      if (String(oldValue) === String(newValue)) return;

      const edit: ScheduleEdit = {
        rowKey: rowKey(event.data),
        columnKey,
        before: oldValue as string | number,
        after: newValue as string | number,
      };
      pushHistory([edit]);

      // event.data is already mutated with the new value by AG-Grid
      const updatedRow = event.data;
      const merged = rowsRef.current.map((r) =>
        rowKey(r) === rowKey(updatedRow) ? updatedRow : r,
      );
      commitRows(merged, new Set([rowKey(updatedRow)]));
    },
    [commitRows, editableKeys, pushHistory],
  );

  // AG-Grid keyboard handler: undo/redo + Community-safe copy/paste
  const onGridCellKeyDown = useCallback(
    (event: CellKeyDownEvent<TableRow>) => {
      const ke = event.event as KeyboardEvent | undefined;
      if (!ke) return;
      const ctrl = ke.ctrlKey || ke.metaKey;
      if (!ctrl) return;
      const key = ke.key.toLowerCase();

      if (key === 'z' && !ke.shiftKey) {
        ke.preventDefault();
        handleUndo();
        return;
      }
      if ((key === 'z' && ke.shiftKey) || key === 'y') {
        ke.preventDefault();
        handleRedo();
        return;
      }
      // Copy: write raw cell value to clipboard (bypasses AG-Grid's formatted copy)
      if (key === 'c') {
        const colId = event.column.getColId();
        if (colId && colId !== '__rowNum__' && event.data) {
          void navigator.clipboard.writeText(cellTextValue(event.data, colId));
          ke.preventDefault();
        }
        return;
      }
      // Paste: read clipboard, coerce to column type, commit via patchRow
      if (key === 'v') {
        const colId = event.column.getColId();
        if (colId && editableKeys.has(colId) && event.data) {
          ke.preventDefault();
          const rowSnap = event.data;
          void navigator.clipboard.readText().then((text) => {
            const trimmed = text.trim();
            const currentRows = rowsRef.current;
            const def = columnDefs.find((c) => c.key === colId);
            let newValue: string | number = trimmed;
            if (def?.type === 'number') {
              const n = Number(trimmed);
              if (!Number.isFinite(n)) return;
              newValue = n;
            } else if (def?.type === 'status') {
              const opts = resolveStatusOptions(def, currentRows);
              if (!opts.includes(trimmed)) return;
            }
            if (newValue === (rowSnap[colId] ?? '')) return;
            const updatedRow = { ...rowSnap, [colId]: newValue };
            const merged = currentRows.map((r) =>
              rowKey(r) === rowKey(updatedRow) ? updatedRow : r,
            );
            const edit: ScheduleEdit = {
              rowKey: rowKey(rowSnap),
              columnKey: colId,
              before: (rowSnap[colId] ?? '') as string | number,
              after: newValue,
            };
            pushHistory([edit]);
            commitRows(merged, new Set([rowKey(updatedRow)]));
          });
        }
      }
    },
    [columnDefs, commitRows, editableKeys, handleRedo, handleUndo, pushHistory],
  );

  // AG-Grid selection changed → sync React selectedRows (used by toolbar + totals)
  const onSelectionChanged = useCallback(
    (event: SelectionChangedEvent<TableRow>) => {
      const selected = event.api
        .getSelectedNodes()
        .filter((n) => n.data != null)
        .map((n) => rowKey(n.data!));
      setSelectedRows(new Set(selected));
      if (selected.length > 0) clearColumnSelection();
    },
    [clearColumnSelection],
  );

  const onGridReady = useCallback((event: GridReadyEvent<TableRow>) => {
    gridApiRef.current = event.api;
  }, []);

  // Status options per column — includes values already present in rows
  const statusOptionsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const def of columnDefs) {
      if (def.type === 'status') map.set(def.key, resolveStatusOptions(def, rows));
    }
    return map;
  }, [columnDefs, rows]);

  // AG-Grid column definitions: row-number + typed data columns
  // 二三级 master-detail (Pro): only on the schedule sheet, only when entitled AND
  // Enterprise modules are loaded (setting masterDetail props otherwise → module error).
  const proMasterDetail =
    activeSheetId === SCHEDULE_SHEET_ID && hasProEntitlement() && isAgGridEnterpriseReady();

  const agColDefs = useMemo<ColDef<TableRow>[]>(() => {
    const defs: ColDef<TableRow>[] = [];

    // Pinned row-number column (read-only, no sort)
    defs.push({
      colId: '__rowNum__',
      headerName: '#',
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      pinned: 'left' as const,
      lockPosition: true,
      sortable: false,
      resizable: false,
      editable: false,
      suppressMovable: true,
      suppressHeaderFilterButton: true,
      valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      cellStyle: {
        textAlign: 'center',
        color: 'var(--muted-foreground)',
        fontSize: '0.75rem',
        fontVariantNumeric: 'tabular-nums',
      },
    });

    // Master-detail expander column (Pro) — the agGroupCellRenderer draws the
    // expand/collapse chevron that reveals each 二级 row's 三级 detail grid.
    if (proMasterDetail) {
      defs.push({
        colId: '__expand__',
        headerName: '',
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        pinned: 'left' as const,
        lockPosition: true,
        sortable: false,
        resizable: false,
        editable: false,
        suppressMovable: true,
        suppressHeaderFilterButton: true,
        cellRenderer: 'agGroupCellRenderer',
      });
    }

    // Data columns
    for (const def of columnDefs) {
      const baseColDef: ColDef<TableRow> = {
        field: def.key,
        colId: def.key,
        headerName: def.name,
        width: def.width,
        resizable: true,
        sortable: true,
        pinned: def.frozen ? ('left' as const) : undefined,
        editable: true,
        cellDataType: false,
        suppressHeaderFilterButton: true,
        valueFormatter: (params: ValueFormatterParams<TableRow>) => {
          const v = params.value;
          return v === undefined || v === null ? '' : String(v);
        },
        // zh-CN numeric comparator — reuses compareScheduleValues
        comparator: (valueA, valueB) =>
          compareScheduleValues(
            valueA as string | number | undefined,
            valueB as string | number | undefined,
            def.type,
          ),
        // Custom header: name click selects column, chevron cycles sort
        headerComponent: AgColumnHeader,
        headerComponentParams: {
          columnKey: def.key,
          onSelect: selectColumn,
          selectedKeyRef: selectedColumnKeyRef,
        },
      };

      if (def.type === 'number') {
        defs.push({
          ...baseColDef,
          cellEditor: 'agNumberCellEditor',
          cellStyle: { textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
        });
      } else if (def.type === 'status') {
        const options = statusOptionsByKey.get(def.key) ?? [];
        defs.push({
          ...baseColDef,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: { values: options },
          cellRenderer: (params: ICellRendererParams<TableRow>) => (
            <div className="flex w-full justify-center px-2">
              <StatusBadge status={String(params.value ?? '')} />
            </div>
          ),
        });
      } else {
        // text
        defs.push({
          ...baseColDef,
          cellEditor: 'agTextCellEditor',
          cellStyle: { textAlign: 'center' },
        });
      }
    }

    return defs;
  }, [columnDefs, statusOptionsByKey, selectColumn, proMasterDetail]);

  // AG-Grid v36 row selection config (object form)
  const rowSelection = useMemo(
    () => ({
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      // checkbox-only selection: clicking a cell (to edit) must NOT select the row.
      // shift-range still works natively via the checkboxes.
      enableClickSelection: false,
    }),
    [],
  );

  const getScheduleDetailRowData = useCallback(
    (params: { data: TableRow; successCallback: (rows: Record<string, unknown>[]) => void }) => {
      void fetchScheduleDetail(params.data['order_id'], params.data['stage_code']).then((rows) =>
        params.successCallback(rows),
      );
    },
    [],
  );

  const detailCellRendererParams = useMemo(
    () => ({
      detailGridOptions: {
        theme: themeQuartz,
        columnDefs: SCHEDULE_DETAIL_COLUMN_DEFS,
        defaultColDef: { flex: 1, minWidth: 100, sortable: true, resizable: true },
      },
      getDetailRowData: getScheduleDetailRowData,
    }),
    [getScheduleDetailRowData],
  );

  const handleAddRow = async () => {
    const res = await fetch('/api/table/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetId }),
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
      body: JSON.stringify({ sheet: activeSheetId, row_keys: [...selectedRows] }),
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
        body: JSON.stringify({ sheet: activeSheetId, name }),
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
      body: JSON.stringify({ sheet: activeSheetId, key: selectedColumnKey }),
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
    selectedColumnKeyRef.current = null;
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
    setImporting(true);
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
      showToast(
        t('table.importSuccess', { count: data.rows?.length ?? importedRows.length }),
        'success',
      );
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t('table.importFailed'), 'error');
    } finally {
      setImporting(false);
      setPendingImportFile(null);
      resetImportInput();
    }
  };

  const confirmImport = () => {
    const file = pendingImportFile;
    if (!file) return;
    setImportConfirmOpen(false);
    void handleImportFile(file);
  };

  const hasActiveFilters = filters.query.trim() !== '';

  if (loading && rows.length === 0 && columnDefs.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {t('table.loading')}
      </div>
    );
  }

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
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sheets.map((sheet) => {
            const active = activeSheetId === sheet.id;
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
                <button
                  type="button"
                  onClick={() => switchSheet(sheet.id)}
                  className="sheet-tab-label py-1 pl-2.5 pr-1 transition-[padding] duration-150"
                >
                  {sheet.name}
                </button>
                {sheets.length > 1 ? (
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

      {/* Toolbar + search */}
      <div className="border-border shrink-0 space-y-2 border-b px-2 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              rowActionDelete && 'text-destructive hover:text-destructive',
            )}
            onClick={handleRowAction}
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
            className={cn(
              'h-7 gap-1 px-2 text-xs',
              columnSelected && 'text-destructive hover:text-destructive',
            )}
            onClick={handleColumnAction}
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
            disabled={importing}
          >
            <label className={cn(importing && 'pointer-events-none opacity-50')}>
              <Upload className="size-3" />
              {importing ? t('table.importing') : t('table.import')}
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                disabled={importing}
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
          >
            <Download className="size-3" />
            {t('table.export')}
          </Button>
          <span className="text-muted-foreground mx-1 hidden h-4 w-px bg-border sm:inline-block" />
          <input
            type="search"
            placeholder={t('table.filterPlaceholder')}
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
              aria-label={t('table.redo')}
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
          <div className="min-h-0 flex-1 text-sm" style={{ height: '100%' }}>
            <AgGridReact<TableRow>
              key={proMasterDetail ? 'grid-md' : 'grid-plain'}
              theme={themeQuartz}
              rowData={filteredRows}
              columnDefs={agColDefs}
              getRowId={(params: GetRowIdParams<TableRow>) => rowKey(params.data)}
              rowSelection={rowSelection}
              masterDetail={proMasterDetail || undefined}
              isRowMaster={proMasterDetail ? () => true : undefined}
              detailCellRendererParams={proMasterDetail ? detailCellRendererParams : undefined}
              onGridReady={onGridReady}
              onCellValueChanged={onCellValueChanged}
              onCellKeyDown={onGridCellKeyDown}
              onSelectionChanged={onSelectionChanged}
            />
          </div>
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
          <DialogFooter className="gap-2 sm:gap-0">
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
          <DialogFooter className="gap-2 sm:gap-0">
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
          <DialogFooter className="gap-2 sm:gap-0">
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
          if (!open) cancelImport();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('table.import')}</DialogTitle>
            <DialogDescription>{t('table.confirmImport')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={cancelImport}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={importing} onClick={confirmImport}>
              {t('table.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
