/** AI SDK v6 UIMessage (minimal shape we receive from assistant-ui). */
import { convertToModelMessages, type UIMessage } from 'ai';
import { getCatalogModel } from '@veylin/runtime';
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
        if (p.type === 'tool-ask_user_question') {
          const output = (p as { output?: { answers?: Record<string, string> } }).output;
          const answers = output?.answers;
          if (!answers || Object.keys(answers).length === 0) return [];
          const answersText = Object.entries(answers)
            .map(([question, answer]) => `"${question}"="${answer}"`)
            .join(', ');
          return [
            `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`,
          ];
        }
        if (p.type === 'tool-read_open_page') {
          const output = (p as {
            output?: { url?: string; title?: string; content?: string; error?: string };
          }).output;
          if (!output) return [];
          if (output.error) return [`read_open_page failed: ${output.error}`];
          const header = [output.title, output.url].filter(Boolean).join(' — ');
          const body = output.content?.trim();
          if (!header && !body) return [];
          return [[header, body].filter(Boolean).join('\n')];
        }
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

const FRONTEND_SUSPEND_TOOL_PART_TYPES = new Set([
  'tool-ask_user_question',
  'tool-read_open_page',
]);

function messageHasModelToolParts(messages: UiMessage[]): boolean {
  return messages.some((m) =>
    m.parts?.some((p) => {
      const type = (p as { type?: string }).type;
      return (
        typeof type === 'string' &&
        type.startsWith('tool-') &&
        !FRONTEND_SUSPEND_TOOL_PART_TYPES.has(type)
      );
    }),
  );
}

function messageHasFrontendSuspendToolParts(message: UiMessage): boolean {
  return Boolean(
    message.parts?.some((p) => {
      const type = (p as { type?: string }).type;
      return typeof type === 'string' && FRONTEND_SUSPEND_TOOL_PART_TYPES.has(type);
    }),
  );
}

/**
 * Convert UIMessages to Mastra agent.stream input. Text-only messages stay as a
 * string; messages carrying images/PDFs become a multimodal content array.
 * When model-executed tool UI parts are present, use AI SDK conversion so tool
 * results reach the model on client-completed tool continuations. Frontend
 * suspend tools (ask_user_question/read_open_page) are user-side context, so
 * convert them to plain text via textOfMessage instead of emitting provider
 * tool protocol blocks.
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
          role: messageHasFrontendSuspendToolParts(m) ? 'user' : m.role,
          content: parts as string | ContentPart[],
        };
      }
      return {
        role: messageHasFrontendSuspendToolParts(m) ? 'user' : m.role,
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
  return (
    '## Attached browser context\n' +
    `The user attached the page currently shown in the desktop docked web view.\n` +
    `- Title: ${title}\n` +
    `- URL: ${attached.url}\n` +
    'Use `read_open_page` to read the fully rendered page (including logged-in intranet content). ' +
    'Do not use `web_fetch` for this page when session cookies matter.'
  );
}

export type WorkspacePanelKind = 'table' | 'rag' | 'web' | 'workflow';

export type WorkspacePanelContext = {
  activePanel?: WorkspacePanelKind;
  webUrl?: string;
  webTitle?: string;
};

/** Hint when the user is focused on a specific right-panel tab. */
export function buildWorkspacePanelHintBlock(
  ctx?: WorkspacePanelContext,
): string {
  if (!ctx?.activePanel) return '';

  switch (ctx.activePanel) {
    case 'table':
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **表格 (spreadsheet)** panel. ' +
        'Spreadsheet rows live in `table_*` tools — not in the knowledge base. ' +
        'Call `table_sheets` (action list) and `table_get` before claiming there is no data.'
      );
    case 'rag':
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **知识库 (knowledge base)** panel. ' +
        'Use `knowledge_search` for uploaded documents; cite excerpts as [1], [2]. ' +
        'Table/spreadsheet data is separate — use `table_*` tools when the question is about grid rows.'
      );
    case 'web': {
      const url = ctx.webUrl?.trim();
      const title = ctx.webTitle?.trim() || url;
      if (url) {
        return (
          '## User focus (right panel)\n' +
          `The user is viewing the **网页 (web)** panel: ${title} (${url}).\n` +
          'Prefer `read_open_page` on desktop for the docked browser (session cookies). ' +
          'Use `web_fetch` only for public URLs when cookies are not required.'
        );
      }
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **网页 (web)** panel. ' +
        'Use `read_open_page` after they open a URL in the docked browser.'
      );
    }
    case 'workflow':
      return (
        '## User focus (right panel)\n' +
        'The user is viewing the **工作流 (workflow)** panel. ' +
        'Use workflow tools when they ask to run or edit automations.'
      );
    default:
      return '';
  }
}
