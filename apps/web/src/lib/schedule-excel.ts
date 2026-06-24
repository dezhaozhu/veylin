import * as XLSX from 'xlsx';
import i18n from '@/i18n';

type ScheduleColumnDef = {
  key: string;
  name: string;
  type: string;
};

type ScheduleRow = Record<string, string | number>;

const STATUS_VALUES = ['normal', 'tight', 'overdue'] as const;

// Recognize raw status values, their localized labels (current + all bundled
// locales) so imported sheets in any language map back to canonical values.
function buildStatusLabelToValue(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const value of STATUS_VALUES) {
    map[value] = value;
    for (const lng of ['en', 'zh-CN']) {
      const label = i18n.t(`sched.status.${value}`, { lng });
      if (label) map[label.trim()] = value;
    }
  }
  return map;
}

function statusDisplayLabel(value: string): string {
  return i18n.t(`sched.status.${value}`, { defaultValue: value });
}

function cellDisplayValue(
  col: ScheduleColumnDef,
  value: string | number | undefined,
): string | number {
  if (value === undefined || value === '') return '';
  if (col.type === 'status') {
    return statusDisplayLabel(String(value));
  }
  return value;
}

function parseCellValue(col: ScheduleColumnDef, raw: unknown): string | number {
  if (raw === undefined || raw === null || raw === '') return '';
  if (col.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : '';
  }
  if (col.type === 'status') {
    const s = String(raw).trim();
    return buildStatusLabelToValue()[s] ?? s;
  }
  return String(raw).trim();
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'schedule';
}

/** Export current sheet columns + rows to an .xlsx download. */
export function exportScheduleToExcel(
  sheetName: string,
  columns: ScheduleColumnDef[],
  rows: ScheduleRow[],
): void {
  const headers = columns.map((c) => c.name);
  const body = rows.map((row) =>
    columns.map((col) => cellDisplayValue(col, row[col.key])),
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${sanitizeFilename(sheetName)}.xlsx`);
}

export type ParsedScheduleImport = {
  rows: ScheduleRow[];
  newColumnNames: string[];
};

/**
 * Parse an uploaded Excel file into row patches keyed by column key.
 * Headers match column `name` or `key`; unknown headers become new columns.
 */
export async function parseScheduleExcelFile(
  file: File,
  columns: ScheduleColumnDef[],
): Promise<ParsedScheduleImport> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], newColumnNames: [] };

  const ws = wb.Sheets[sheetName]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];

  if (matrix.length === 0) return { rows: [], newColumnNames: [] };

  const headerRow = (matrix[0] ?? []).map((h) => String(h ?? '').trim());
  const dataRows = matrix.slice(1).filter((row) =>
    row.some((cell) => String(cell ?? '').trim() !== ''),
  );

  const columnByHeader = new Map<string, ScheduleColumnDef>();
  const newColumnNames: string[] = [];

  for (const header of headerRow) {
    if (!header) continue;
    const found =
      columns.find((c) => c.name === header) ??
      columns.find((c) => c.key === header);
    if (found) {
      columnByHeader.set(header, found);
    } else {
      newColumnNames.push(header);
      columnByHeader.set(header, {
        key: header,
        name: header,
        type: 'text',
      });
    }
  }

  const rows: ScheduleRow[] = dataRows.map((cells) => {
    const row: ScheduleRow = { order_no: '' };
    headerRow.forEach((header, idx) => {
      if (!header) return;
      const col = columnByHeader.get(header);
      if (!col) return;
      row[col.key] = parseCellValue(col, cells[idx]);
    });
    return row;
  });

  return { rows, newColumnNames };
}
