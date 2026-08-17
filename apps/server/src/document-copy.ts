/**
 * 可编辑副本 —— **原件不动,改发生在副本上**。
 *
 * 为什么不原地改 docx:Word 会把一句话拆进好几个 `<w:r>`(拼写检查、局部格式都
 * 会切),你选中的那段在文件里很可能不是连续存着的。"保格式改 docx"是一整块
 * 最容易出错的代码,而它换来的只是省掉一次另存。副本这条路把它整块绕开。
 *
 * 三条规矩:
 * 1. **原件是原件。** `.veylin/originals` 里那份 0444 的字节一个不动;副本是
 *    `文稿/x.md`,和它之间只有一根 provenance 指针(从哪个哈希来的)。
 * 2. **改要按原文锚点,找不到/不唯一就拒。** 模糊匹配会改到别处,而且看不出来。
 * 3. **版本只增不删。** 回退 = 追加一版内容等于旧版的新版本,不是抹掉中间那几版
 *    —— 工业场景里"上一版长什么样、什么时候变的"是要能查的。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import TurndownService from 'turndown';

const COPY_DIR = '文稿';

// —— 原件 → markdown ————————————————————————————————

/** `<td>` 里的纯文本(mammoth 会往格子里塞 `<p>`)。 */
function cellText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    // 竖线不转义会把表格结构撑破
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * `<table>` → GFM 表格。
 *
 * **必须自己来**:turndown 默认把表格拍成几段孤立文字(实测),行列关系就没了 ——
 * 而表格恰恰是这类工艺/计划文档里信息最密的地方。
 */
function tableToMarkdown(html: string): string {
  const rows: string[][] = [];
  /** 还欠下面几行的格子:`[列号, 剩余行数, 内容]`。 */
  let pending: Array<{ col: number; left: number; text: string }> = [];

  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const raw = (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => {
      const span = (re: RegExp) => Number(re.exec(c)?.[1] ?? 1) || 1;
      return {
        text: cellText(c.replace(/^<t[hd][^>]*>/i, '').replace(/<\/t[hd]>$/i, '')),
        rowspan: span(/rowspan\s*=\s*"?(\d+)"?/i),
        colspan: span(/colspan\s*=\s*"?(\d+)"?/i),
      };
    });
    if (!raw.length) continue;

    // markdown 表格没有合并单元格。**rowspan 要在下面几行补上内容** ——
    // 不补的话下一行整体左移,原本第二列的东西看起来就跑进了第一列:
    // 一张读起来完全正常、但每个格子都错位的表(真文档实测)。
    const row: string[] = [];
    const carried = pending;
    /** 本行**新**声明的 rowspan:不能在本行末尾就被减掉,否则一行都没轮到它。 */
    const declared: Array<{ col: number; left: number; text: string }> = [];
    let i = 0;
    for (let col = 0; row.length < 64; col++) {
      const held = carried.find((p) => p.col === col);
      if (held) { row[col] = held.text; continue; }
      if (i >= raw.length) break;
      const cell = raw[i++]!;
      row[col] = cell.text;
      // colspan 占满它该占的列,否则整张表的列数对不齐
      for (let k = 1; k < cell.colspan; k++) row[col + k] = '';
      if (cell.rowspan > 1) {
        declared.push({ col, left: cell.rowspan - 1, text: cell.text });
      }
      col += cell.colspan - 1;
    }
    pending = [
      ...carried.map((p) => ({ ...p, left: p.left - 1 })).filter((p) => p.left > 0),
      ...declared,
    ];
    rows.push(Array.from(row, (c) => c ?? ''));
  }
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  // 第一行当表头:Word 的表格第一行几乎总是表头,而 GFM 表格必须有一行表头。
  return [line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)]
    .join('\n');
}

export function htmlToMarkdown(html: string): string {
  // 先把表格摘出来换成占位符,免得 turndown 把它拍平。
  const tables: string[] = [];
  const withPlaceholders = html.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    tables.push(tableToMarkdown(m));
    // 占位符里不能有 markdown 的特殊字符:turndown 会把 `_` 转义成 `\_`,
    // 于是还原时的正则对不上,表格就这么无声无息地丢了(实测)。
    return `<p>zzveylintablezz${tables.length - 1}zz</p>`;
  });

  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  const md = td.turndown(withPlaceholders);
  return md
    .replace(/zzveylintablezz(\d+)zz/g, (_, i: string) => `\n${tables[Number(i)] ?? ''}\n`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// —— 按锚点改 ————————————————————————————————————

export type EditOutcome =
  | { ok: true; text: string; diff: string }
  | { ok: false; reason: string };

function unifiedDiff(before: string, after: string): string {
  const b = before.split('\n');
  const a = after.split('\n');
  const out: string[] = [];
  const max = Math.max(b.length, a.length);
  for (let i = 0; i < max; i++) {
    if (b[i] === a[i]) continue;
    if (b[i] !== undefined) out.push(`- ${b[i]}`);
    if (a[i] !== undefined) out.push(`+ ${a[i]}`);
  }
  return out.join('\n');
}

/**
 * 按**原文锚点**替换。找不到、不唯一、改了等于没改 —— 三种都拒,并说出下一步。
 *
 * 不做模糊匹配:猜着改会改到别处,而且改完了看不出来 —— 这是文档编辑里最坏的
 * 一类失败,因为人只会去看他以为改了的那一处。
 */
export function applyAnchoredEdit(text: string, find: string, replace: string): EditOutcome {
  if (!find) return { ok: false, reason: '没有给要改的原文' };
  if (find === replace) return { ok: false, reason: '改前改后一样,没有变化' };

  let count = 0;
  let idx = text.indexOf(find);
  const first = idx;
  while (idx !== -1) {
    count++;
    idx = text.indexOf(find, idx + find.length);
  }
  if (count === 0) {
    return { ok: false, reason: `找不到这段原文:「${find.slice(0, 40)}」—— 照原文一字不差地给,或换一段。` };
  }
  if (count > 1) {
    return {
      ok: false,
      reason: `这段原文在文稿里出现了 ${count} 处,不知道改哪一处。` +
        '把锚点写长一点(多带前后一两句),让它只对上一处。',
    };
  }
  const next = text.slice(0, first) + replace + text.slice(first + find.length);
  return { ok: true, text: next, diff: unifiedDiff(text, next) };
}

// —— 落盘与版本 ————————————————————————————————

export const copyDir = (folder: string) => `${folder.replace(/\/+$/, '')}/${COPY_DIR}`;
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export type Revision = {
  n: number;
  at: string;
  hash: string;
  note: string;
  /** 这份文稿最初来自哪份原件(内容哈希)。没有 = 凭空新建的。 */
  fromHash?: string;
};

const REV_DIR = '.veylin/revisions';

/** 副本文件名:`工艺.docx` → `工艺.md`。原名留着,一眼看得出它从哪来。 */
export function copyNameOf(originalName: string): string {
  const base = originalName.split(/[\\/]/).pop() ?? originalName;
  return `${base.replace(/\.[^.]+$/, '')}.md`;
}

function guardInside(folder: string, name: string): string {
  const root = resolve(folder);
  const target = resolve(folder, name);
  const rel = relative(root, target);
  if (rel.startsWith('..') || resolve(root, rel) !== target) {
    throw new Error('只能在项目文件夹里操作');
  }
  return target;
}

const copyPath = (folder: string, originalName: string) =>
  join(copyDir(folder), copyNameOf(originalName));
const revDirOf = (folder: string, originalName: string) =>
  join(folder, REV_DIR, copyNameOf(originalName));
const indexPath = (folder: string, originalName: string) =>
  join(revDirOf(folder, originalName), 'index.json');

export async function listRevisions(folder: string, originalName: string): Promise<Revision[]> {
  try {
    const raw = await readFile(indexPath(folder, originalName), 'utf8');
    const parsed = JSON.parse(raw) as { revisions?: Revision[] };
    return Array.isArray(parsed.revisions) ? parsed.revisions : [];
  } catch {
    return [];
  }
}

async function appendRevision(
  folder: string, originalName: string, text: string, note: string, fromHash?: string,
): Promise<Revision> {
  const dir = revDirOf(folder, originalName);
  await mkdir(dir, { recursive: true });
  const revs = await listRevisions(folder, originalName);
  const rev: Revision = {
    n: revs.length + 1,
    at: new Date().toISOString(),
    hash: sha256(text),
    note,
    ...(fromHash ? { fromHash } : {}),
  };
  // 每一版的正文单独留一份:索引里只有哈希的话,回退时就没有内容可回。
  await writeFile(join(dir, `${rev.n}.md`), text, 'utf8');
  await writeFile(
    indexPath(folder, originalName),
    JSON.stringify({ version: 1, revisions: [...revs, rev] }, null, 2),
    'utf8',
  );
  return rev;
}

export async function readCopy(folder: string, originalName: string): Promise<string | null> {
  try {
    return await readFile(copyPath(folder, originalName), 'utf8');
  } catch {
    return null;
  }
}

/**
 * 打开(必要时创建)可编辑副本。
 *
 * **已经有副本就用已有的** —— 每次打开都从原件重建,会把人改过的内容悄悄盖回去。
 */
export async function openCopy(
  folder: string, originalName: string,
): Promise<{ path: string; text: string; created: boolean; fromHash?: string }> {
  guardInside(folder, originalName);
  const target = copyPath(folder, originalName);
  const existing = await readCopy(folder, originalName);
  if (existing != null) {
    const revs = await listRevisions(folder, originalName);
    return {
      path: target, text: existing, created: false,
      ...(revs[0]?.fromHash ? { fromHash: revs[0].fromHash } : {}),
    };
  }

  const { extractDocument } = await import('./document-extract.js');
  const bytes = await readFile(resolve(folder, originalName));
  const out = await extractDocument(originalName, bytes, { limit: 100_000 });
  if (out.kind === 'unsupported') {
    throw new Error(out.notice ?? `读不了 ${originalName},没法做成可改的副本`);
  }
  // 有版式就走 HTML→markdown(表格才活得下来);没有就用纯文字。
  const md = out.html ? htmlToMarkdown(out.html) : (out.text ?? out.overview ?? '');
  const fromHash = createHash('sha256').update(bytes).digest('hex');

  await mkdir(copyDir(folder), { recursive: true });
  // 副本是**可写的** —— 它就是拿来改的。原件/快照/生成物才是 0444。
  await writeFile(target, md, 'utf8');
  await appendRevision(folder, originalName, md, `从原件「${originalName}」建立`, fromHash);
  return { path: target, text: md, created: true, fromHash };
}

export async function saveRevision(
  folder: string, originalName: string, text: string, note: string,
): Promise<Revision> {
  guardInside(folder, originalName);
  await mkdir(copyDir(folder), { recursive: true });
  await writeFile(copyPath(folder, originalName), text, 'utf8');
  return appendRevision(folder, originalName, text, note);
}

/**
 * 回退到第 n 版。**追加一版内容等于旧版的新版本**,不抹掉中间那几版 ——
 * 工业场景里"上一版长什么样、什么时候变的"是要能查的。
 */
export async function rollbackTo(
  folder: string, originalName: string, n: number,
): Promise<Revision> {
  const revs = await listRevisions(folder, originalName);
  const target = revs.find((r) => r.n === n);
  // 退到不存在的版本要拒绝 —— 悄悄退到最近的一版,人会以为自己回到了那一版。
  if (!target) throw new Error(`没有第 ${n} 版(现在共 ${revs.length} 版)`);
  const body = await readFile(join(revDirOf(folder, originalName), `${n}.md`), 'utf8');
  return saveRevision(folder, originalName, body, `回退到第 ${n} 版`);
}
