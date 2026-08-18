const BOM = '\ufeff';

/**
 * 把一张表导出成文件。
 *
 * 缺口是用户实测出来的:面板工具条上明明有「导出」,agent 却回
 * 「当前可用的表格工具不支持导出为 CSV/Excel」—— **人有按钮、agent 没有工具**。
 * 和之前 table_import_file 是同一类不对称:同一件事,两条路只通了一条。
 *
 * 只写进**项目文件夹**(和生成 docx 同一条规矩:落盘的东西要有归属)。没绑文件夹
 * 时不假装成功,而是直说去点面板上的导出 —— 那条路不需要文件夹。
 */

/** CSV 一格:含逗号/引号/换行就加引号,引号翻倍。 */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const head = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  // BOM:Excel 打开 UTF-8 CSV 不加它就是乱码 —— 导出是给人用的,乱码等于没导。
  return `${BOM}${[head, ...body].join('\r\n')}\r\n`;
}

/** 落盘的文件名:去掉路径分隔符和控制字符,保留中文。 */
export function exportFileName(sheetName: string): string {
  // **先 trim 再净化**:反过来的话空格会先被换成下划线,`'   '` 变成 `'___'`,
  // 空名兜底就永远走不到。
  const trimmed = sheetName.trim();
  const base = trimmed ? trimmed.replace(/[\\/:*?"<>|]/g, '_') : '表格';
  return `${base}.csv`;
}
