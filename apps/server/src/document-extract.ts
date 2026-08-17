/**
 * Office 文件 → 文字。**一处实现,两个入口**:项目文件夹里按需读的
 * (project-file-read),和拖进对话框的附件(chat)。
 *
 * 分开写过一次的代价看得见:同一份 xlsx,走文件夹能读、拖进来回一句"转成 PDF
 * 再来",而用户完全无法理解这两条路为什么不一样。能力边界该跟着**文件**走,
 * 不跟着**它从哪儿进来**走。
 *
 * 三条自定规矩:
 * 1. **表格永远只给概览。** 四万九千行吐出来既塞不下也没法用,还会让 agent 以为
 *    自己拿到了全部。要分析就导入成表用 `table_query`。
 * 2. **PPT 留页码。** "第 3 页"是人在 PPT 里定位的唯一坐标;混成一段文字,agent
 *    引用得再准也没人找得到。
 * 3. **读不了要说得出下一步。** 只说"不支持"等于把人堵死在这儿。
 */
import { extname } from 'node:path';

export type ExtractKind = 'text' | 'sheet' | 'doc' | 'slides' | 'unsupported';

export type ExtractPlan = { kind: ExtractKind; note?: string };

export type Extracted = {
  kind: ExtractKind;
  text?: string;
  totalLines?: number;
  /** 表格的人读版概览 —— 预览面板直接显示这一段。 */
  overview?: string;
  /**
   * 有版式的预览(Word / 表格)。**渲染方必须放进沙箱 iframe** —— 它来自
   * 用户的文件,不是我们写的模板。
   */
  html?: string;
  /** 首页缩略图(PDF)。data URL。 */
  thumbnail?: string;
  /**
   * 总页数。**只有 PDF 有** —— Word 转出来的 HTML 是连续的流,给它编页码是编的,
   * 人会拿着"第 3 页"去对原文然后发现对不上。
   */
  pageCount?: number;
  sheets?: string[];
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  totalRows?: number;
  notice?: string;
};

const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.log', '.yaml', '.yml',
  '.xml', '.html', '.htm', '.ts', '.tsx', '.js', '.py', '.sql', '.ini', '.conf', '.toml']);
const SHEET = new Set(['.xlsx', '.xls', '.xlsm', '.csv']);
const DOC = new Set(['.docx']);
const SLIDES = new Set(['.pptx']);
const PDF = new Set(['.pdf']);

/** 老二进制格式:不是"没做",是**做不了** —— 说清楚并给出一条真能走的路。 */
const LEGACY = new Set(['.doc', '.ppt', '.xls']);

export function planExtract(name: string): ExtractPlan {
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
  if (SLIDES.has(ext)) return { kind: 'slides' };
  if (PDF.has(ext)) return { kind: 'doc' };
  if (LEGACY.has(ext)) {
    return {
      kind: 'unsupported',
      note: `${ext} 是老的二进制格式,读不了。用 Office 另存为 ${ext === '.doc' ? '.docx' : ext === '.ppt' ? '.pptx' : '.xlsx'} 再来。`,
    };
  }
  return {
    kind: 'unsupported',
    note: `读不了 ${ext || '这种'} 文件。可以转成 md/txt,或者(PDF)直接拖进对话框。`,
  };
}

const DEFAULT_LINES = 200;
const DEFAULT_ROWS = 5;

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `<a:t>…</a:t>` 里的文字。OOXML 的文字全在这一个标签里。 */
function runsOf(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) {
    const t = m[1]!
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    if (t.trim()) out.push(t);
  }
  return out;
}

/** slide7.xml → 7。**按数字排**,否则 slide10 会排到 slide2 前面。 */
function indexOf(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

async function extractPptx(bytes: Buffer): Promise<Extracted> {
  let zip;
  try {
    const JSZip = (await import('jszip')).default;
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    return { kind: 'unsupported', notice: `读不了这份 PPT:${e instanceof Error ? e.message : String(e)}` };
  }
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => indexOf(a) - indexOf(b));
  if (!slides.length) {
    return { kind: 'unsupported', notice: '这份 PPT 里没有找到幻灯片(可能不是 pptx)。' };
  }
  const lines: string[] = [];
  for (const path of slides) {
    const n = indexOf(path);
    // 空页也出:缺一页会让人以为内容漏了,而"这一页没有文字"是事实。
    lines.push(`— 第 ${n} 页 —`);
    lines.push(...runsOf(await zip.files[path]!.async('string')));
    const notes = zip.files[`ppt/notesSlides/notesSlide${n}.xml`];
    if (notes) {
      // 讲者备注常常是承诺和口径的真正所在,但它没在台上讲过 —— 标明来源。
      const text = runsOf(await notes.async('string'));
      if (text.length) lines.push(`  [备注] ${text.join(' ')}`);
    }
  }
  return { kind: 'slides', text: lines.join('\n'), totalLines: lines.length };
}

/**
 * 首页缩略图。**失败只是少一张图** —— 正文照给,不能因为画不出来就整份读不了。
 * (扫描件更要给:它只有图能看。)
 */
async function pdfThumbnail(pdf: unknown): Promise<{ thumbnail?: string }> {
  try {
    const { renderPageAsImage } = await import('unpdf');
    const url = (await renderPageAsImage(pdf as never, 1, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 1.2,
      toDataURL: true,
    })) as string;
    return url?.startsWith('data:') ? { thumbnail: url } : {};
  } catch {
    return {};
  }
}

/**
 * 按页渲染 PDF。**越界返回 null,不返回别的页** —— 静默给错的一页,比报个错坏得多:
 * 人会以为自己看的是第 99 页。
 */
export async function renderPdfPage(bytes: Buffer, page: number): Promise<string | null> {
  try {
    const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (!Number.isInteger(page) || page < 1 || page > (pdf.numPages as number)) return null;
    const url = (await renderPageAsImage(pdf, page, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 1.6,
      toDataURL: true,
    })) as string;
    return url?.startsWith('data:') ? url : null;
  } catch {
    return null;
  }
}

async function extractPdf(bytes: Buffer): Promise<Extracted> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const body = (Array.isArray(text) ? text.join('\n') : text).trim();
    if (body.length < 16) {
      // 扫描件回一段空白,等于告诉人"这份文件是空的"。说出它是扫描件,
      // 人才知道该换个模型看图,或者去找可复制文字的版本。
      return {
        kind: 'doc',
        text: '',
        pageCount: pdf.numPages as number,
        ...(await pdfThumbnail(pdf)),
        notice: `这份 PDF 没有可提取的文字层(多半是扫描件,共 ${pdf.numPages} 页)。` +
          '把它拖进对话框、并切到能看图的模型,才读得了。',
      };
    }
    return {
      kind: 'doc',
      text: body,
      totalLines: body.split('\n').length,
      pageCount: pdf.numPages as number,
      ...(await pdfThumbnail(pdf)),
    };
  } catch (e) {
    return { kind: 'unsupported', notice: `读不了这份 PDF:${e instanceof Error ? e.message : String(e)}` };
  }
}

async function extractDocx(bytes: Buffer, opts: { offset?: number; limit?: number }): Promise<Extracted> {
  try {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    // 纯文字会把 Word 里的表格拍平成一行一格,人会以为原文就长这样。
    // HTML 保住标题层级和表格 —— 失败了只是少一个更好的预览,不影响正文。
    const html = await mammoth
      .convertToHtml({ buffer: bytes })
      .then((r) => r.value as string)
      .catch(() => undefined);
    const all = value.split('\n');
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, opts.limit ?? DEFAULT_LINES);
    const slice = all.slice(offset, offset + limit);
    const rest = all.length - offset - slice.length;
    return {
      kind: 'doc',
      text: slice.join('\n'),
      ...(html ? { html } : {}),
      totalLines: all.length,
      ...(rest > 0 ? { notice: `还有 ${rest} 行没给 —— 用 offset 继续读。` } : {}),
    };
  } catch (e) {
    return { kind: 'unsupported', notice: `读不了这份 Word:${e instanceof Error ? e.message : String(e)}` };
  }
}

async function extractSheet(bytes: Buffer, opts: { limit?: number }): Promise<Extracted> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(bytes);
  const first = wb.SheetNames[0];
  const ws = first ? wb.Sheets[first] : undefined;
  const json = ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) : [];
  const limit = Math.max(1, opts.limit ?? DEFAULT_ROWS);
  const columns = json.length ? Object.keys(json[0]!) : [];
  const shown = json.slice(0, limit);
  // 人读版:只回结构化字段的话,预览面板拿不到任何可显示的东西,只能说
  // "这个文件没有可直接预览的文本内容" —— 而我们明明读到了。
  const overview = [
    `页签:${wb.SheetNames.join('、')}`,
    `列(${columns.length}):${columns.join(' | ')}`,
    `共 ${json.length} 行,下面是前 ${shown.length} 行:`,
    '',
    ...shown.map((r, i) => `${i + 1}. ` + columns.map((c) => `${c}=${String(r[c] ?? '')}`).join('  ')),
  ].join('\n');
  // 有版式的预览:行列关系是表格的全部意义,拍成文字就没了。
  // **每个格子都转义** —— 单元格里可以躺着一段 `<script>`,而这段 HTML 会被
  // 渲染出来(渲染方另外还会放进沙箱 iframe,两层都要有)。
  const html =
    '<table><thead><tr>' + columns.map((c) => `<th>${esc(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    shown.map((r) => '<tr>' + columns.map((c) => `<td>${esc(r[c])}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>';
  return {
    kind: 'sheet',
    html,
    overview,
    sheets: wb.SheetNames,
    columns,
    totalRows: json.length,
    rows: shown,
    notice: `这是概览(共 ${json.length} 行,给了 ${Math.min(limit, json.length)} 行)。`
      + '要筛选、分组、统计,把它导入成表再用 `table_query` —— 不要靠这里翻页。',
  };
}

/** 字节 → 文字/概览。文件从磁盘来还是从对话框拖进来,走的是同一条。 */
export async function extractDocument(
  name: string,
  bytes: Buffer,
  opts: { offset?: number; limit?: number } = {},
): Promise<Extracted> {
  const plan = planExtract(name);
  switch (plan.kind) {
    case 'unsupported':
      return { kind: 'unsupported', notice: plan.note };
    case 'slides':
      return extractPptx(bytes);
    case 'doc':
      return extname(name).toLowerCase() === '.pdf'
        ? extractPdf(bytes)
        : extractDocx(bytes, opts);
    case 'sheet':
      return extractSheet(bytes, opts);
    case 'text': {
      const all = bytes.toString('utf8').split('\n');
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
  }
}
