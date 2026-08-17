/** AI SDK v6 UIMessage (minimal shape we receive from assistant-ui). */
import { convertToModelMessages, type UIMessage } from 'ai';
import { getCatalogModel } from '@veylin/runtime';
import { projectSourceLabel } from '@veylin/shared';
import {
  decodeDataUrlToUtf8,
  isBinaryAttachment,
  isTextLikeAttachment,
  textAttachmentToPart,
  unsupportedAttachmentPart,
} from './attachment-text';

type UiPart = {
  type: string;
  text?: string;
  // FileUIPart (images + documents): url is a data URL or hosted URL.
  mediaType?: string;
  url?: string;
  filename?: string;
};
type UiMessage = {
  role: string;
  content?: string;
  parts?: UiPart[];
};

/** Mastra/AI-SDK core content part for a multimodal message. */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string }
  | { type: 'file'; data: string; mimeType: string; filename?: string };

type ChatBody = {
  id?: string;
  messages?: UiMessage[];
  threadId?: string;
  agentId?: string;
  resume?: {
    runId: string;
    toolCallId?: string;
    resumeData: unknown;
  };
  model?: string;
  toolQuery?: string;
  planMode?: boolean;
  /** Loop chip armed; model should analyze conditions and call loop_set when ready. */
  pendingLoop?: boolean;
  mcpEnabled?: Record<string, boolean>;
  /** Skill to auto-activate when sending the next message. */
  pendingSkill?: string;
  /** Force client snapshot to replace server memory (e.g. compaction). */
  forceReplace?: boolean;
  /** Browser page attached via @ mention (desktop web view). */
  attachedBrowser?: { tabId: string; url: string; title: string };
  /** Active right-panel tab (表格 / 知识库 / 网页) for workspace-aware prompts. */
  workspacePanel?: WorkspacePanelContext;
  /** UI locale from react-i18next (en | zh-CN). */
  locale?: string;
};

/** Extract plain text from a UIMessage (v6 parts or legacy content string). */
export function textOfMessage(msg: UiMessage | undefined): string {
  if (!msg) return '';
  if (typeof msg.content === 'string' && msg.content) return msg.content;
  return (
    msg.parts
      ?.flatMap((p) => {
        if (p.type === 'text' && p.text) return [p.text];
        return [];
      })
      .join('\n') ?? ''
  );
}

/** Last user message text — used for dynamic tool search. */
export function lastUserText(messages: UiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return textOfMessage(m);
  }
  return '';
}

function dataUrlToBuffer(url: string): Uint8Array | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  return Uint8Array.from(Buffer.from(url.slice(comma + 1), 'base64'));
}

/** Catalog ids or `*` (from VEYLIN_VISION_MODELS) that accept image content. */
function visionCatalogIds(): Set<string> {
  const raw = process.env.VEYLIN_VISION_MODELS?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export function modelSupportsImages(model: string | undefined): boolean {
  if (!model) return false;
  const envIds = visionCatalogIds();
  if (envIds.has('*')) return true;
  if (envIds.has(model)) return true;
  return getCatalogModel(model)?.vision === true;
}

const PDF_MAX_PAGES = Number(process.env.VEYLIN_PDF_MAX_PAGES ?? 10);
const PDF_RENDER_SCALE = Number(process.env.VEYLIN_PDF_RENDER_SCALE ?? 1.5);

/**
 * Convert a PDF data URL into model content. Our OpenAI-compatible providers do
 * not accept PDF document parts, so we reproduce the native dual-channel that
 * Claude/Gemini do internally: always extract the text layer, and — when the
 * selected model is vision-capable — also render each page to an image. This
 * lets the model read scanned pages, charts, and layout. Text-only models get
 * the extracted text alone (with a hint when there is no usable text layer).
 */
async function pdfToParts(url: string, filename: string, vision: boolean): Promise<ContentPart[]> {
  const bytes = dataUrlToBuffer(url);
  if (!bytes) return [];
  const name = filename || 'document.pdf';
  try {
    const { extractText, getDocumentProxy, renderPageAsImage } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const totalPages: number = pdf.numPages;
    const { text } = await extractText(pdf, { mergePages: true });
    const body = (Array.isArray(text) ? text.join('\n') : text).trim();
    const hasText = body.length >= 16;

    const parts: ContentPart[] = [];

    if (vision) {
      const pageCount = Math.min(totalPages, PDF_MAX_PAGES);
      const header =
        `[Attached PDF "${name}", ${totalPages} page(s); ` +
        `${pageCount} page image(s) below + extracted text]`;
      parts.push({ type: 'text', text: `${header}\n${body || '(no extractable text layer)'}` });
      for (let i = 1; i <= pageCount; i++) {
        try {
          const dataUrl = (await renderPageAsImage(pdf, i, {
            canvasImport: () => import('@napi-rs/canvas'),
            scale: PDF_RENDER_SCALE,
            toDataURL: true,
          })) as string;
          parts.push({ type: 'image', image: dataUrl });
        } catch {
          // Skip a page that fails to render; text channel still covers it.
        }
      }
      return parts;
    }

    // Text-only model: extracted text, or a hint to switch when scanned.
    const note = hasText
      ? `[Attached PDF "${name}", ${totalPages} page(s)]\n${body}`
      : `[Attached PDF "${name}" has no extractable text layer (likely scanned). ` +
        `Switch to a vision-capable model to read it as images.]`;
    return [{ type: 'text', text: note }];
  } catch {
    return [{ type: 'text', text: `[Attached PDF could not be parsed: ${name}]` }];
  }
}

const OFFICE_EXTENSIONS = new Set([
  '.docx', '.xlsx', '.xlsm', '.pptx',
  // 老二进制格式也走这条:抽取器读不了它们,但它给的是"用 Office 另存为 .docx
  // 再来"这种能照做的话,比通用那句"convert to PDF or plain text"有用。
  '.doc', '.xls', '.ppt',
]);

/** 交给 Office 抽取器处理的后缀(含读不了但要好好拒的老格式)。 */
export function isOfficeAttachment(filename: string): boolean {
  const i = filename.lastIndexOf('.');
  return i >= 0 && OFFICE_EXTENSIONS.has(filename.slice(i).toLowerCase());
}

/** data URL → 字节。不是 data URL 就返回 null(不猜)。 */
function decodeDataUrlToBytes(url: string): Buffer | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  if (!url.slice(5, comma).includes('base64')) return null;
  try {
    return Buffer.from(url.slice(comma + 1), 'base64');
  } catch {
    return null;
  }
}

/**
 * 拖进对话框的 Office 文件(docx / xlsx / pptx)→ 文字。
 *
 * 走的是**项目文件夹那条同一个抽取器**(`document-extract`)。从前这里是一堵墙:
 * 同一份 xlsx,放进项目文件夹能读概览,拖进来只回一句"转成 PDF 再来" —— 这个
 * 区别对用户毫无道理可讲,因为它根本不该存在。
 *
 * 表格照旧**只给概览**:附件这条路没有分页,把三万行塞进提示词既装不下,更糟的是
 * 模型会以为自己拿到了全部,然后基于前一千行下结论。
 */
export async function officeAttachmentToParts(
  url: string,
  filename: string,
): Promise<ContentPart[]> {
  const name = filename || 'attachment';
  const bytes = decodeDataUrlToBytes(url);
  if (!bytes) {
    return [{ type: 'text', text: `[附件 "${name}" 读不了:拿不到文件内容]` }];
  }
  const { extractDocument } = await import('./document-extract.js');
  const out = await extractDocument(name, bytes);
  if (out.kind === 'unsupported') {
    return [{ type: 'text', text: `[附件 "${name}" 读不了:${out.notice ?? '格式不支持'}]` }];
  }
  if (out.kind === 'sheet') {
    const head = `[附件 "${name}" —— 表格概览]`;
    const body = [
      `页签:${(out.sheets ?? []).join('、')}`,
      `列:${(out.columns ?? []).join('、')}`,
      `共 ${out.totalRows ?? 0} 行,下面是前 ${out.rows?.length ?? 0} 行:`,
      JSON.stringify(out.rows ?? [], null, 0),
      out.notice ?? '',
    ].join('\n');
    return [{ type: 'text', text: `${head}\n${body}` }];
  }
  const label = out.kind === 'slides' ? 'PPT' : 'Word';
  return [{
    type: 'text',
    text: `[附件 "${name}" —— ${label} 正文]\n${out.text ?? ''}${out.notice ? `\n${out.notice}` : ''}`,
  }];
}

async function textFileToParts(url: string, filename: string, mediaType: string): Promise<ContentPart[]> {
  const name = filename || 'attachment.txt';
  if (isBinaryAttachment(name, mediaType)) {
    return [unsupportedAttachmentPart(name, mediaType)];
  }
  if (!isTextLikeAttachment(name, mediaType)) {
    return [unsupportedAttachmentPart(name, mediaType)];
  }
  const raw = decodeDataUrlToUtf8(url);
  if (raw == null) {
    return [
      {
        type: 'text',
        text:
          `[Attached file "${name}" could not be decoded as UTF-8 text. ` +
          `If it is binary, convert to PDF or plain text and re-attach.`,
      },
    ];
  }
  return [textAttachmentToPart(name, raw)];
}

/** Convert file/image parts (FileUIPart) of a UIMessage into core content parts. */
async function fileParts(msg: UiMessage, vision: boolean): Promise<ContentPart[]> {
  const out: ContentPart[] = [];
  for (const p of msg.parts ?? []) {
    if (p.type !== 'file' || !p.url) continue;
    const mediaType = p.mediaType ?? 'application/octet-stream';
    const filename = p.filename ?? '';
    if (mediaType.startsWith('image/')) {
      out.push({ type: 'image', image: p.url });
    } else if (mediaType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      out.push(...(await pdfToParts(p.url, filename, vision)));
    } else if (isOfficeAttachment(filename)) {
      // Office 要排在 isBinaryAttachment 之前 —— 它按后缀把 docx/xlsx/pptx 判成
      // 二进制,那正是从前"转成 PDF 再来"那句话的出处。
      out.push(...(await officeAttachmentToParts(p.url, filename)));
    } else if (isTextLikeAttachment(filename, mediaType)) {
      out.push(...(await textFileToParts(p.url, filename, mediaType)));
    } else if (isBinaryAttachment(filename, mediaType)) {
      out.push(unsupportedAttachmentPart(filename, mediaType));
    } else {
      // Unknown type: try UTF-8 decode before giving up (e.g. extensionless config files).
      const raw = decodeDataUrlToUtf8(p.url);
      if (raw != null) {
        out.push(textAttachmentToPart(filename || 'attachment.txt', raw));
      } else {
        out.push(unsupportedAttachmentPart(filename, mediaType));
      }
    }
  }
  return out;
}

function messageHasModelToolParts(messages: UiMessage[]): boolean {
  return messages.some((m) =>
    m.parts?.some((p) => {
      const type = (p as { type?: string }).type;
      return typeof type === 'string' && type.startsWith('tool-');
    }),
  );
}

/**
 * Convert UIMessages to Mastra agent.stream input. Text-only messages stay as a
 * string; messages carrying images/PDFs become a multimodal content array.
 * When tool UI parts are present, use AI SDK conversion so calls/results keep
 * their native provider protocol instead of becoming synthetic user text.
 */
export async function toAgentMessages(
  messages: UiMessage[],
  vision = false,
): Promise<{ role: string; content: string | ContentPart[] | unknown }[]> {
  if (messageHasModelToolParts(messages)) {
    const modelMessages = await convertToModelMessages(messages as UIMessage[], {
      ignoreIncompleteToolCalls: true,
    });
    return modelMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  const converted = await Promise.all(
    messages.map(async (m) => {
      const text = textOfMessage(m);
      const files = await fileParts(m, vision);
      if (files.length > 0) {
        const parts: ContentPart[] = [];
        if (text) parts.push({ type: 'text', text });
        parts.push(...files);
        return {
          role: m.role,
          content: parts as string | ContentPart[],
        };
      }
      return {
        role: m.role,
        content: text as string | ContentPart[],
      };
    }),
  );
  return converted.filter((m) =>
    Array.isArray(m.content) ? m.content.length > 0 : m.content.length > 0 || m.role === 'user',
  );
}

export function parseChatBody(raw: unknown): ChatBody {
  if (!raw || typeof raw !== 'object') return {};
  return raw as ChatBody;
}

/** Hint for the model when the user @-attached a docked browser page. */
export function buildAttachedBrowserBlock(
  attached?: ChatBody['attachedBrowser'],
): string {
  if (!attached?.url) return '';
  const title = attached.title?.trim() || attached.url;
  const tabHint = attached.tabId?.trim()
    ? `\n- tabId: ${attached.tabId.trim()} (pass this to read_open_page)`
    : '';
  return (
    '## Attached browser context\n' +
    `The user attached a page from the desktop docked web view.\n` +
    `- Title: ${title}\n` +
    `- URL: ${attached.url}` +
    tabHint +
    '\n' +
    'Use `read_open_page` with that tabId (when provided) to read the fully rendered page ' +
    '(including logged-in intranet content). ' +
    'Do not use `web_fetch` for this page when session cookies matter.'
  );
}

/**
 * Display label for a pinned project (v3: pins are project ids, and the
 * model-facing reminder must name the project, never a raw MCP entry name):
 * the project's display name plus its source labels (shared
 * `projectSourceLabel`). A single-source default project whose name IS its
 * source label collapses to just the name; composed projects list their
 * sources after the name.
 */
export function projectPinLabel(project: { name: string; sources: string[] }): string {
  const joined = project.sources.map((source) => projectSourceLabel(source)).join('、');
  if (!joined || joined === project.name) return project.name;
  return `${project.name}(数据源: ${joined})`;
}

/**
 * System reminder scoping this turn to the thread's pinned data project.
 *
 * `pinLabel` is the resolved project's DISPLAY label (name + source labels,
 * see `projectPinLabel`), or null when the thread is unpinned / its pin
 * denied — v3 pins are project ids, which mean nothing to the model, so
 * routes/chat.ts resolves the pin through `resolvePinnedProjectScope` first
 * and passes only the human-readable label here.
 *
 * Unpinned (`pinLabel === null`) is not silently unscoped: routes/chat.ts no
 * longer auto-pins an unpinned thread to a group's alphabetical-first member
 * (a silent default-tenant guess) — the thread simply has no grouped MCP
 * servers this turn (个人/personal area). This reminder tells the model that
 * plainly, plus how a human gets factory data into scope, instead of leaving
 * it to guess why no Compass tools showed up.
 *
 * `move` carries the boundary marker (audit fix #3): when a thread's pin
 * changed away from a previously non-null project, earlier turns in this
 * same thread's transcript were written under that OLD project's data
 * scope — without an explicit marker the model has no signal that a fact
 * recalled from history may belong to a project it's no longer pinned to.
 * This still applies when the thread moved back OUT to the personal area
 * (`pinLabel === null`, `move.movedFrom` set). `movedFrom` is display-only
 * and printed as-is (it may be a legacy entry name or a project id).
 */
export function buildProjectPinBlock(
  pinLabel: string | null,
  move?: { movedFrom: string | null; movedAt: string | null } | null,
  /**
   * 项目级指令(用户在"这个项目要做什么"里写的)。**这是它存在的意义** ——
   * 不喂给模型的话,那个输入框就只是个装饰。
   *
   * 放在钉定块里而不是另起一节:它和"当前是哪个项目"是同一件事的两半 ——
   * 项目变了,指令必须跟着变;分成两处迟早会有一处忘了跟。
   */
  instructions?: string | null,
  /** 这个项目一个数据源都没接 —— 只在这种情况下才提示,挂好后这句消失。 */
  hasNoSources = false,
): string {
  const lines = ['<system-reminder>'];
  if (pinLabel) {
    lines.push(`当前数据项目: ${pinLabel}(本会话所有数据均来自该项目,勿引用其他项目)`);
    // **只在零数据源时说**。挂好之后这句就消失 —— 稳态下不该每轮都在处理一件
    // 早就解决了的事。
    if (hasNoSources) {
      lines.push(
        '这个项目还没有接任何数据源,所以现在查不到工厂数据。' +
        '需要时先用 list_my_scenes 看看这个身份有哪些场景,' +
        '再确认要挂哪一个 —— **用户没有指明就要问,不要替他挑一个**。',
      );
    }
    const trimmed = (instructions ?? '').trim();
    if (trimmed) {
      // 明确标出这是**用户为这个项目写的**,不是系统规则 —— 两者的权威不同,
      // 混在一起模型无从判断该以谁为准。
      lines.push(`该项目的说明(用户写给这个项目的,适用于本项目全部对话):\n${trimmed}`);
    }
  } else {
    lines.push(
      '当前会话在「个人」区,未绑定任何项目数据源;需要查看工厂数据时,请在侧边栏选择项目新建会话,或用会话菜单将本会话移动到项目。',
    );
  }
  if (move?.movedFrom) {
    lines.push(
      `本会话曾属于项目 ${move.movedFrom}(${move.movedAt ?? '未知时间'} 移动);` +
        '此前的对话内容属于原项目,不可作为当前项目的数据依据',
    );
  }
  lines.push('</system-reminder>');
  return lines.join('\n');
}

export type WorkspacePanelKind = 'table' | 'rag' | 'web' | 'workflow';

export type OpenWebTabContext = {
  tabId: string;
  url: string;
  title: string;
  isActive?: boolean;
};

export type WorkspacePanelContext = {
  activePanel?: WorkspacePanelKind;
  webUrl?: string;
  webTitle?: string;
  openWebTabs?: OpenWebTabContext[];
};

function formatOpenWebTabsHint(tabs: OpenWebTabContext[]): string {
  if (tabs.length === 0) return '';
  const lines = tabs.map((t) => {
    const label = t.title?.trim() || t.url;
    const active = t.isActive ? ' (focused)' : '';
    return `- tabId=${t.tabId}: ${label} — ${t.url}${active}`;
  });
  return (
    '\nOpen web tabs:\n' +
    lines.join('\n') +
    '\nPass `tabId` to `read_open_page` to read a non-focused tab.'
  );
}

/** Hint when the user is focused on a specific right-panel tab. */
export function buildWorkspacePanelHintBlock(
  ctx?: WorkspacePanelContext,
): string {
  if (!ctx?.activePanel) return '';

  const openTabs =
    Array.isArray(ctx.openWebTabs) && ctx.openWebTabs.length > 0
      ? formatOpenWebTabsHint(
          ctx.openWebTabs.filter((t) => typeof t?.tabId === 'string' && t.url?.trim()),
        )
      : '';

  switch (ctx.activePanel) {
    case 'table':
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **表格 (spreadsheet)** panel. ' +
        'Spreadsheet rows live in `table_*` tools — not in the knowledge base. ' +
        'Call `table_sheets` (action list) and `table_get` before claiming there is no data.' +
        openTabs
      );
    case 'rag':
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **知识库 (knowledge base)** panel. ' +
        'Use `knowledge_search` for uploaded documents; cite excerpts as [1], [2]. ' +
        'Table/spreadsheet data is separate — use `table_*` tools when the question is about grid rows.' +
        openTabs
      );
    case 'web': {
      const url = ctx.webUrl?.trim();
      const title = ctx.webTitle?.trim() || url;
      if (url) {
        return (
          '## User focus (right panel)\n' +
          `The user is viewing the **网页 (web)** panel: ${title} (${url}).\n` +
          'Prefer `read_open_page` on desktop for the docked browser (session cookies). ' +
          'Use `web_fetch` only for public URLs when cookies are not required.' +
          openTabs
        );
      }
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **网页 (web)** panel. ' +
        'Use `read_open_page` after they open a URL in the docked browser.' +
        openTabs
      );
    }
    case 'workflow':
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **工作流 (workflow)** panel. ' +
        'Use workflow tools when they ask to run or edit automations.' +
        openTabs
      );
    default:
      return '';
  }
}
