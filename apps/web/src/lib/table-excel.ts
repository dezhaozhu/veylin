import * as XLSX from 'xlsx';
import { DEFAULT_TABLE_STATUS_OPTIONS } from '@veylin/shared';
import i18n from '@/i18n';

type TableColumnDef = {
  key: string;
  name: string;
  type: string;
  statusOptions?: string[];
};

type TableRow = Record<string, string | number>;

function resolveStatusOptions(col: TableColumnDef): string[] {
  if (col.statusOptions?.length) return col.statusOptions;
  return [...DEFAULT_TABLE_STATUS_OPTIONS];
}

function buildStatusLabelToValue(col: TableColumnDef): Record<string, string> {
  const map: Record<string, string> = {};
  for (const value of resolveStatusOptions(col)) {
    map[value] = value;
    for (const lng of ['en', 'zh-CN']) {
      const label = i18n.t(`table.status.${value}`, { lng });
      if (label) map[label.trim()] = value;
    }
  }
  return map;
}

function statusDisplayLabel(value: string): string {
  return i18n.t(`table.status.${value}`, { defaultValue: value });
}

function cellDisplayValue(
  col: TableColumnDef,
  value: string | number | undefined,
): string | number {
  if (value === undefined || value === '') return '';
  if (col.type === 'status') {
    return statusDisplayLabel(String(value));
  }
  return value;
}

function parseCellValue(col: TableColumnDef, raw: unknown): string | number {
  if (raw === undefined || raw === null || raw === '') return '';
  if (col.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : '';
  }
  if (col.type === 'status') {
    const s = String(raw).trim();
    return buildStatusLabelToValue(col)[s] ?? s;
  }
  return String(raw).trim();
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'table';
}

function inferColumnType(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower === 'status' || lower === '状态') return 'status';
  return 'text';
}

/** Export current sheet columns + rows to an .xlsx download. Returns the filename used. */
export function exportTableToExcel(
  sheetName: string,
  columns: TableColumnDef[],
  rows: TableRow[],
): string {
  const headers = columns.map((c) => c.name);
  const body = rows.map((row) =>
    columns.map((col) => cellDisplayValue(col, row[col.key])),
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const filename = `${sanitizeFilename(sheetName)}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}

export type ParsedTableImport = {
  columnNames: string[];
  rows: TableRow[];
};

/**
 * Parse an uploaded Excel/CSV file. First row = column headers; following rows = data.
 * Headers become the full column set on import (replacing any existing columns).
 */
export async function parseTableExcelFile(file: File): Promise<ParsedTableImport> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { columnNames: [], rows: [] };

  const ws = wb.Sheets[sheetName]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];

  if (matrix.length === 0) return { columnNames: [], rows: [] };

  const headerRow = (matrix[0] ?? []).map((h) => String(h ?? '').trim());
  const columnNames = headerRow.filter((h) => h !== '');
  if (columnNames.length === 0) return { columnNames: [], rows: [] };

  const columnDefs: TableColumnDef[] = columnNames.map((name) => ({
    key: name,
    name,
    type: inferColumnType(name),
    ...(inferColumnType(name) === 'status'
      ? { statusOptions: [...DEFAULT_TABLE_STATUS_OPTIONS] }
      : {}),
  }));

  const dataRows = matrix.slice(1).filter((row) =>
    row.some((cell) => String(cell ?? '').trim() !== ''),
  );

  const rows: TableRow[] = dataRows.map((cells) => {
    const row: TableRow = {};
    columnNames.forEach((header, idx) => {
      const col = columnDefs[idx];
      if (!col) return;
      row[header] = parseCellValue(col, cells[idx]);
    });
    return row;
  });

  return { columnNames, rows };
}
