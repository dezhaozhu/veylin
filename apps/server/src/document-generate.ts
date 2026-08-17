/**
 * 生成 Word / PPT。
 *
 * **输入是 markdown**:模型本来就写 markdown,再发明一套结构只会让它填错格子。
 * 支持的子集是明说的 —— 标题、段落、无序/有序列表、表格、引用、代码块;别的
 * 原样当正文。**明说的子集比"看起来什么都支持"诚实**:一个悄悄丢掉表格的转换器,
 * 生成出来的文件看着正常,内容却少了一块。
 *
 * 生成物不是原件:它落进 `生成/`,和 `快照/` 同一套规矩 —— 只读、文件名带生成
 * 时间、同一分钟再生成不覆盖前一份。原件仓(.veylin/originals)一个字都不动。
 */
import type { Paragraph as DocxParagraph, Table as DocxTable } from 'docx';
import { marked, type Tokens } from 'marked';

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'li'; text: string; ordered: boolean; index: number }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'table'; header: string[]; rows: string[][] };

/** markdown 行内标记去掉 —— 我们不做富文本,留着 `**` 更难看。 */
function plain(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const tk of marked.lexer(md)) {
    switch (tk.type) {
      case 'heading':
        out.push({ t: 'h', level: (tk as Tokens.Heading).depth, text: plain((tk as Tokens.Heading).text) });
        break;
      case 'paragraph':
        out.push({ t: 'p', text: plain((tk as Tokens.Paragraph).text) });
        break;
      case 'list': {
        const l = tk as Tokens.List;
        l.items.forEach((it, i) => {
          out.push({ t: 'li', text: plain(it.text), ordered: !!l.ordered, index: i + 1 });
        });
        break;
      }
      case 'blockquote':
        out.push({ t: 'quote', text: plain((tk as Tokens.Blockquote).text) });
        break;
      case 'code':
        out.push({ t: 'code', text: (tk as Tokens.Code).text });
        break;
      case 'table': {
        const tb = tk as Tokens.Table;
        out.push({
          t: 'table',
          header: tb.header.map((c) => plain(c.text)),
          rows: tb.rows.map((r) => r.map((c) => plain(c.text))),
        });
        break;
      }
      default:
        // hr / space / html 之类:不生成东西,但也不报错 —— 汇报里出现它们很正常。
        break;
    }
  }
  return out;
}

export async function generateDocx(title: string, markdown: string): Promise<Buffer> {
  const {
    AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow,
    TextRun, WidthType,
  } = await import('docx');

  const HEADINGS = [
    HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
  ];
  const cell = (text: string, head = false) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: head })] })],
    });

  const blocks = parseBlocks(markdown);
  // 正文本来就以同名的一级标题开头时,不再插一个 —— 否则生成出来标题连着重复
  // 两遍(真生成实测踩到的)。标题不一样就两个都留:那是两件事。
  const first = blocks[0];
  const startsWithTitle = first?.t === 'h' && first.level === 1 && first.text === title.trim();
  const body: Array<DocxParagraph | DocxTable> = startsWithTitle
    ? []
    : [new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.LEFT })];
  for (const b of blocks) {
    switch (b.t) {
      case 'h':
        body.push(new Paragraph({ text: b.text, heading: HEADINGS[Math.min(b.level, 6) - 1] }));
        break;
      case 'p':
        body.push(new Paragraph({ text: b.text }));
        break;
      case 'li':
        body.push(new Paragraph({
          text: b.text,
          ...(b.ordered ? { numbering: undefined, text: `${b.index}. ${b.text}` } : { bullet: { level: 0 } }),
        }));
        break;
      case 'quote':
        body.push(new Paragraph({ text: b.text, indent: { left: 480 } }));
        break;
      case 'code':
        body.push(new Paragraph({ children: [new TextRun({ text: b.text, font: 'Consolas' })] }));
        break;
      case 'table':
        // 真表格,不是拍平的文字 —— 拍平之后行列关系就没了。
        body.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: b.header.map((h) => cell(h, true)) }),
            ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
          ],
        }));
        // Word 里两张表贴在一起会被并成一张;垫一个空段落。
        body.push(new Paragraph({ text: '' }));
        break;
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children: body }] })) as Promise<Buffer>;
}

export type Slide = { title: string; body: string };

/**
 * markdown 切成幻灯片。**按二级标题切,`---` 也切** —— 这是人写汇报时本来的结构,
 * 不用另教一套语法。一个标题都没有就是一页(不是零页:零页的 PPT 打开是空的)。
 */
export function splitSlides(markdown: string): Slide[] {
  const slides: Slide[] = [];
  let cur: Slide | null = null;
  const push = () => { if (cur && (cur.title || cur.body.trim())) slides.push(cur); };

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) {
      push();
      cur = { title: plain(h[2]!), body: '' };
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      push();
      cur = { title: '', body: '' };
      continue;
    }
    if (!cur) cur = { title: '', body: '' };
    cur.body += `${line}\n`;
  }
  push();
  return slides.length ? slides : [{ title: '', body: markdown }];
}

export async function generatePptx(title: string, markdown: string): Promise<Buffer> {
  const ns = await import('pptxgenjs');
  const Ctor = ((ns as unknown as { default?: unknown }).default ?? ns) as new () => {
    layout: string;
    addSlide: () => { addText: (t: string, o: Record<string, unknown>) => void };
    write: (o: Record<string, unknown>) => Promise<unknown>;
  };
  const deck = new Ctor();
  deck.layout = 'LAYOUT_16x9';

  for (const s of splitSlides(markdown)) {
    const slide = deck.addSlide();
    slide.addText(s.title || title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 26, bold: true });
    const lines = parseBlocks(s.body)
      .flatMap((b) => (b.t === 'table'
        // PPT 里不画表:一页塞不下,而且塞进去也读不了。说出它在哪儿。
        ? [`（表格 ${b.rows.length} 行,见 Word 版）`]
        : 'text' in b ? [b.text] : []))
      .filter(Boolean);
    if (lines.length) {
      slide.addText(lines.map((t) => `• ${t}`).join('\n'), {
        x: 0.6, y: 1.4, w: 8.8, h: 4, fontSize: 16, valign: 'top',
      });
    }
  }
  return (await deck.write({ outputType: 'nodebuffer' })) as Buffer;
}

// —— 落盘:和 `快照/` 同一套规矩 ——————————————————————————

const GENERATED_DIR = '生成';
const two = (n: number) => String(n).padStart(2, '0');

/**
 * 生成物放这儿。**不放项目根** —— 根目录的 .docx/.pptx 会被收件箱当成
 * "有新文件待导入",于是我们自己刚生成的东西,转头请人再导一遍。
 */
export function generatedDir(folder: string): string {
  return `${folder.replace(/\/+$/, '')}/${GENERATED_DIR}`;
}

/** `上重进度 2026-08-16 15-20.docx` —— 带生成时间,半年后还知道是哪一版。 */
export function generatedFileName(title: string, ext: 'docx' | 'pptx', at: Date): string {
  const stamp =
    `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ` +
    `${two(at.getHours())}-${two(at.getMinutes())}`;
  return `${title.replace(/[/\\:*?"<>|]/g, '_').trim() || '文档'} ${stamp}.${ext}`;
}

export async function saveGenerated(
  folder: string,
  title: string,
  ext: 'docx' | 'pptx',
  bytes: Buffer,
  at: Date,
): Promise<{ path: string; name: string }> {
  const { chmod, mkdir, stat, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = generatedDir(folder);
  await mkdir(dir, { recursive: true });

  // 同一分钟再生成不覆盖前一份 —— 被悄悄改写的产物,就不再是那次的产物了。
  const base = generatedFileName(title, ext, at);
  let name = base;
  let n = 2;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await stat(join(dir, name));
      name = base.replace(new RegExp(`\\.${ext}$`), ` (${n++}).${ext}`);
    } catch {
      break;
    }
  }
  const target = join(dir, name);
  await writeFile(target, bytes);
  await chmod(target, 0o444);          // 从此不变,和快照同一条规矩
  return { path: target, name: `${GENERATED_DIR}/${name}` };
}
