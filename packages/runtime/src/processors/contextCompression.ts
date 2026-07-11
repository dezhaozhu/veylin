import type { Processor } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/memory';
import {
  getAutoCompactThreshold,
  isAutoCompactDisabled,
  recordCompactFailure,
  recordCompactSuccess,
} from '../context-window';
import { formatCompactSummary } from '../summarizer';

export type Summarizer = (text: string) => Promise<string>;

export interface ContextCompressionOptions {
  keepRecent?: number;
  triggerAt?: number;
  llmTriggerAt?: number;
  tokenTriggerAt?: number;
  tokenLlmTriggerAt?: number;
  perMessageChars?: number;
  summarizer?: Summarizer | undefined;
  /** When true, always compact (manual /compact). Ignores count/token thresholds. */
  force?: boolean;
}

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

type ContentPart = { type: string; text?: string; [key: string]: unknown };

function partsOf(message: MastraDBMessage): ContentPart[] {
  const parts = (message as { content?: { parts?: ContentPart[] } }).content?.parts;
  return parts ?? [];
}

function textOf(message: MastraDBMessage): string {
  return partsOf(message)
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join(' ');
}

/** Serialize non-text parts (tool results, etc.) for token estimation / transcripts. */
function partPayload(part: ContentPart): string {
  if (part.type === 'text' && typeof part.text === 'string') return part.text;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part.type ?? '');
  }
}

function contentChars(message: MastraDBMessage): number {
  const parts = partsOf(message);
  if (parts.length === 0) return textOf(message).length;
  let chars = 0;
  for (const p of parts) chars += partPayload(p).length;
  return chars;
}

function transcriptLine(message: MastraDBMessage): string {
  const role = (message as { role?: string }).role ?? 'msg';
  const parts = partsOf(message);
  if (parts.length === 0) return `${role}: ${textOf(message)}`;
  const body = parts.map(partPayload).join('\n');
  return `${role}: ${body}`;
}

/** Rough token estimate (char/4 heuristic), including tool-result payloads. */
export function estimateTokens(messages: MastraDBMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += contentChars(m);
  return Math.ceil(chars / 4);
}

let compactGeneration = 0;

export function getCompactGeneration(): number {
  return compactGeneration;
}

export function bumpCompactGeneration(): number {
  compactGeneration += 1;
  return compactGeneration;
}

/** RequestContext key set when auto/manual compaction rewrites the input transcript. */
export const VEYLIN_CONTEXT_COMPACTED_KEY = 'veylinContextCompacted';

export type VeylinContextCompacted = {
  beforeTokens: number;
  afterTokens: number;
  beforeMessages: number;
  afterMessages: number;
  generation: number;
};

type ProcessInputArgs = {
  messages: MastraDBMessage[];
  requestContext?: { set: (key: string, value: unknown) => void };
};

/**
 * Two-tier context compaction: message count, token estimate, or context-window % threshold.
 */
export class ContextCompression implements Processor {
  id = 'context-compression';
  private keepRecent: number;
  private triggerAt: number;
  private llmTriggerAt: number;
  private tokenTriggerAt: number;
  private tokenLlmTriggerAt: number;
  private perMessageChars: number;
  private summarizer?: Summarizer | undefined;
  private force: boolean;

  constructor(opts: ContextCompressionOptions = {}) {
    this.keepRecent = opts.keepRecent ?? envInt('VEYLIN_COMPACT_KEEP', 12);
    this.triggerAt = opts.triggerAt ?? envInt('VEYLIN_COMPACT_TRIGGER', 24);
    this.llmTriggerAt = opts.llmTriggerAt ?? envInt('VEYLIN_COMPACT_LLM_TRIGGER', 48);
    this.tokenTriggerAt = opts.tokenTriggerAt ?? envInt('VEYLIN_COMPACT_TOKEN_TRIGGER', 4000);
    this.tokenLlmTriggerAt =
      opts.tokenLlmTriggerAt ?? envInt('VEYLIN_COMPACT_TOKEN_LLM_TRIGGER', 12000);
    this.perMessageChars = opts.perMessageChars ?? envInt('VEYLIN_COMPACT_PER_MSG', 240);
    this.summarizer = opts.summarizer;
    this.force = opts.force === true;
  }

  async processInput({
    messages,
    requestContext,
  }: ProcessInputArgs): Promise<MastraDBMessage[]> {
    if (isAutoCompactDisabled() && !this.force) return messages;

    const tokens = estimateTokens(messages);
    const autoThreshold = getAutoCompactThreshold();
    const overCount = messages.length > this.triggerAt;
    const overTokens = tokens > this.tokenTriggerAt;
    const overAutoWindow = tokens > autoThreshold;

    if (!this.force && !overCount && !overTokens && !overAutoWindow) return messages;

    const keep = this.force
      ? Math.min(this.keepRecent, Math.max(1, messages.length - 1))
      : this.keepRecent;
    const head = messages.slice(0, messages.length - keep);
    const tail = messages.slice(messages.length - keep);
    if (head.length === 0) return messages;

    const useLlm =
      this.summarizer &&
      (this.force ||
        messages.length > this.llmTriggerAt ||
        tokens > this.tokenLlmTriggerAt ||
        overAutoWindow);
    let summaryText: string;
    let generation = getCompactGeneration();

    try {
      if (useLlm && this.summarizer) {
        const transcript = head.map(transcriptLine).join('\n');
        try {
          const summary = await this.summarizer(transcript);
          generation = bumpCompactGeneration();
          summaryText =
            `[Conversation compacted (gen ${generation}): the ${head.length} earlier message(s) were summarized below. ` +
            `Treat this as the authoritative record of that span. Resume unfinished work silently — ` +
            `do not greet, do not restate the whole summary, and do not ask whether to continue ` +
            `unless the summary conflicts with the latest user intent.]\n\n` +
            formatCompactSummary(summary);
        } catch {
          summaryText = this.deterministic(head);
        }
      } else {
        summaryText = this.deterministic(head);
      }
      recordCompactSuccess();
    } catch {
      recordCompactFailure();
      throw new Error('context compaction failed');
    }

    const summaryMessage = {
      ...(head[0] as MastraDBMessage),
      role: 'system',
      content: {
        ...(head[0] as { content?: object }).content,
        parts: [{ type: 'text', text: summaryText }],
      },
    } as unknown as MastraDBMessage;

    const result = [summaryMessage, ...tail];
    requestContext?.set(VEYLIN_CONTEXT_COMPACTED_KEY, {
      beforeTokens: tokens,
      afterTokens: estimateTokens(result),
      beforeMessages: messages.length,
      afterMessages: result.length,
      generation,
    } satisfies VeylinContextCompacted);

    return result;
  }

  private deterministic(head: MastraDBMessage[]): string {
    return (
      `[Conversation compacted: ${head.length} earlier messages summarized below. ` +
      `Resume unfinished work silently — do not greet, restate the whole summary, or ask whether to continue ` +
      `unless it conflicts with the latest user intent.]\n` +
      head
        .map((m) => {
          const role = (m as { role?: string }).role ?? 'msg';
          return `- ${role}: ${textOf(m).slice(0, this.perMessageChars)}`;
        })
        .join('\n')
    );
  }
}
