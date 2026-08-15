/**
 * 按需读项目文件夹里的文件。
 *
 * **文件夹即上下文 ≠ 把文件塞进 context**:上下文里只有"这里有哪些文件",内容
 * 要用时再取 —— 与 `table_query` 是同一个道理,只是从「行」抬到「文件」。
 *
 * 这里最要紧的是**能力边界诚实**:每类文件能做到什么由代码说清楚,不能让 agent
 * 拿到半截内容当全部。表格只给概览(页签/表头/前几行)并明说"要分析请导进来用
 * table_query";读不了的类型直接说读不了,并给一条可行的替代。
 */
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import * as XLSX from 'xlsx';

export type ReadPlan = { kind: 'text' | 'sheet' | 'doc' | 'unsupported'; note?: string };

const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.log', '.yaml', '.yml',
  '.xml', '.html', '.htm', '.ts', '.tsx', '.js', '.py', '.sql', '.ini', '.conf', '.toml']);
const SHEET = new Set(['.xlsx', '.xls', '.xlsm', '.csv']);
const DOC = new Set(['.docx']);

export function planFileRead(name: string): ReadPlan {
  const ext = extname(name).toLowerCase();
  // .csv 两边都算:当文本读最直接,所以文本优先
  if (TEXT.has(ext)) return { kind: 'text' };
  if (SHEET.has(ext)) {
    return {
      kind: 'sheet',
      note: '表格只给概览(页签、表头、前几行)。要真正分析,把它导入成表再用 `table_query` 筛选/分组。',
    };
  }
  if (DOC.has(ext)) return { kind: 'doc' };
  return {
    kind: 'unsupported',
    note: `服务端读不了 ${ext || '这种'} 文件。可以把它**拖进对话**(前端能抽取 PDF/更多格式的文字),或者转成 md/txt 放进文件夹。`,
  };
}

export type ReadResult = {
  kind: 'text' | 'sheet' | 'doc' | 'unsupported' | 'refused' | 'missing';
  text?: string;
  totalLines?: number;
  sheets?: string[];
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  totalRows?: number;
  notice?: string;
};

const DEFAULT_LINES = 200;
const DEFAULT_ROWS = 5;

export async function readProjectFile(
  folder: string,
  name: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<ReadResult> {
  const root = resolve(folder);
  const target = resolve(folder, name);
  // 只许读项目文件夹之内 —— 与 Show in Folder 同一条边界
  const rel = relative(root, target);
  if (rel.startsWith('..') || resolve(root, rel) !== target) {
    return { kind: 'refused', notice: '只能读项目文件夹里的文件' };
  }
  try {
    await stat(target);
  } catch {
    return { kind: 'missing', notice: `文件不在:${name}` };
  }

  const plan = planFileRead(name);
  if (plan.kind === 'unsupported') return { kind: 'unsupported', notice: plan.note };

  if (plan.kind === 'text') {
    const all = (await readFile(target, 'utf8')).split('\n');
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, opts.limit ?? DEFAULT_LINES);
    const slice = all.slice(offset, offset + limit);
    const rest = all.length - offset - slice.length;
    return {
      kind: 'text',
      text: slice.join('\n'),
      totalLines: all.length,
      ...(rest > 0
        ? { notice: `还有 ${rest} 行没给 —— 用 offset=${offset + slice.length} 继续读。` }
        : {}),
    };
  }

  if (plan.kind === 'doc') {
    try {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: await readFile(target) });
      const all = value.split('\n');
      const limit = Math.max(1, opts.limit ?? DEFAULT_LINES);
      const offset = Math.max(0, opts.offset ?? 0);
      const slice = all.slice(offset, offset + limit);
      const rest = all.length - offset - slice.length;
      return {
        kind: 'doc',
        text: slice.join('\n'),
        totalLines: all.length,
        ...(rest > 0 ? { notice: `还有 ${rest} 行没给 —— 用 offset 继续读。` } : {}),
      };
    } catch (e) {
      return { kind: 'unsupported', notice: `读不了这份 Word:${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // 表格:只给概览。**不吐全量** —— 四万九千行吐出来既塞不下也没法用。
  const wb = XLSX.read(await readFile(target));
  const first = wb.SheetNames[0];
  const ws = first ? wb.Sheets[first] : undefined;
  const json = ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) : [];
  const limit = Math.max(1, opts.limit ?? DEFAULT_ROWS);
  return {
    kind: 'sheet',
    sheets: wb.SheetNames,
    columns: json.length ? Object.keys(json[0]!) : [],
    totalRows: json.length,
    rows: json.slice(0, limit),
    notice: `这是概览(共 ${json.length} 行,给了 ${Math.min(limit, json.length)} 行)。`
      + '要筛选、分组、统计,把它导入成表再用 `table_query` —— 不要靠这里翻页。',
  };
}
