/**
 * 把一份表格文件(xlsx/xls/csv)整表解析成"列 + 行"。
 *
 * 为什么需要它:agent 从前**没有把文件导进表格面板的路**。它只有
 * `project_file_read`,而那个对表格**只给概览(前几行)**,于是真到了"把这张表
 * 导进来"就卡住 —— 用户实测里它说的是「你提供的概览只给了前 5 行,原始文件显示
 * 共 9 行。后 4 行需要你补充数据后我再录入」。人能用界面的「导入」,agent 不能,
 * 这不是模型笨,是缺一把工具。
 *
 * 界面那条导入是在浏览器里用 SheetJS 解析完再 POST 行的;这里是同一件事的
 * 服务端版本,好让工具也能走。
 */
import * as XLSX from 'xlsx';

/** 一次导入的行数上限。超了要**说出来**,不能默默截断。 */
export const MAX_IMPORT_ROWS = 50_000;

export type ParsedSheet = {
  /** 实际用了工作簿里的哪个页签 */
  sheet: string;
  /** 工作簿里其它页签(没导的那些)—— 要让人知道自己拿到的是哪一份 */
  others: string[];
  columns: string[];
  rows: Array<Record<string, string>>;
  /** 超上限被截断时的实话;没截断就没有 */
  notice?: string;
};

/** 表头去重/补名:空表头给「列N」,重名加后缀 —— 列名是行数据的键,不能撞。 */
export function normalizeHeaders(raw: unknown[]): string[] {
  const out: string[] = [];
  const used = new Map<string, number>();
  raw.forEach((cell, i) => {
    const base = String(cell ?? '').trim() || `列${i + 1}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    out.push(seen === 0 ? base : `${base}_${seen + 1}`);
  });
  return out;
}

export function parseSpreadsheet(bytes: Buffer, wanted?: string): ParsedSheet {
  const book = XLSX.read(bytes, { type: 'buffer' });
  const names = book.SheetNames;
  const sheet = wanted && names.includes(wanted) ? wanted : (names[0] ?? '');
  const ws = sheet ? book.Sheets[sheet] : undefined;
  const others = names.filter((n) => n !== sheet);
  if (!ws) return { sheet, others, columns: [], rows: [] };

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
  const headerRow = matrix[0];
  if (!headerRow) return { sheet, others, columns: [], rows: [] };

  const columns = normalizeHeaders(headerRow);
  const body = matrix.slice(1);
  const kept = body.slice(0, MAX_IMPORT_ROWS);
  const rows = kept.map((line) => {
    const row: Record<string, string> = {};
    columns.forEach((name, i) => {
      row[name] = String(line[i] ?? '').trim();
    });
    return row;
  });

  return {
    sheet,
    others,
    columns,
    rows,
    ...(body.length > kept.length
      ? { notice: `这张表有 ${body.length} 行,只导了前 ${kept.length} 行(单次上限)。` }
      : {}),
  };
}
