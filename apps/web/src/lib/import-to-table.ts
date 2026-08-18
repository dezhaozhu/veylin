/**
 * 把一份表格文件导进表格面板的**新表**里。
 *
 * 预览弹窗里"在右侧打开"对表格的含义就是这个:预览只是概览(前几行),而真正
 * 能筛选、统计、被 table_query 用的形态是表格面板里那张表。
 *
 * **一定是新表,不覆盖当前表** —— 面板里那张可能正是人辛苦整理的,覆盖等于
 * 把它吃掉;重名就加序号。
 */
import { newSheetName } from '@/lib/preview-open-action';
import { parseTableExcelFile } from '@/lib/table-excel';

type ImportResult = { ok: true; sheetName: string; rows: number } | { ok: false; message: string };

export async function importFileToNewSheet(
  file: File,
  threadId: string | undefined,
): Promise<ImportResult> {
  const { rows, columnNames } = await parseTableExcelFile(file);
  if (columnNames.length === 0 || rows.length === 0) {
    return { ok: false, message: '这个文件里没有可导入的数据行' };
  }

  const listed = await (
    await fetch(`/api/table/sheets${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''}`)
  ).json();
  const existing = (listed.sheets ?? []).map((s: { name: string }) => s.name);
  const name = newSheetName(file.name, existing);

  const created = await fetch('/api/table/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, threadId }),
  });
  const createdBody = (await created.json()) as { ok?: boolean; sheet?: { id: string }; message?: string };
  if (!created.ok || !createdBody.ok || !createdBody.sheet) {
    return { ok: false, message: createdBody.message ?? '建不出新表' };
  }

  const res = await fetch('/api/table/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet: createdBody.sheet.id, threadId, column_names: columnNames, rows }),
  });
  const body = (await res.json()) as { ok?: boolean; message?: string; rows?: unknown[] };
  if (!res.ok || !body.ok) return { ok: false, message: body.message ?? '导入失败' };

  return { ok: true, sheetName: name, rows: body.rows?.length ?? rows.length };
}
