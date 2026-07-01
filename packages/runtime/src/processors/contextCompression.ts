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
}

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function textOf(message: MastraDBMessage): string {
  const parts = (message as { content?: { parts?: { type: string; text?: string }[] } }).content
    ?.parts;
  if (!parts) return '';
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join(' ');
}

/** Rough token estimate (char/4 heuristic, aligned with Mastra TokenLimiter). */
export function estimateTokens(messages: MastraDBMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += textOf(m).length;
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

  constructor(opts: ContextCompressionOptions = {}) {
    this.keepRecent = opts.keepRecent ?? envInt('VEYLIN_COMPACT_KEEP', 12);
    this.triggerAt = opts.triggerAt ?? envInt('VEYLIN_COMPACT_TRIGGER', 24);
    this.llmTriggerAt = opts.llmTriggerAt ?? envInt('VEYLIN_COMPACT_LLM_TRIGGER', 48);
    this.tokenTriggerAt = opts.tokenTriggerAt ?? envInt('VEYLIN_COMPACT_TOKEN_TRIGGER', 6000);
    this.tokenLlmTriggerAt =
      opts.tokenLlmTriggerAt ?? envInt('VEYLIN_COMPACT_TOKEN_LLM_TRIGGER', 12000);
    this.perMessageChars = opts.perMessageChars ?? envInt('VEYLIN_COMPACT_PER_MSG', 240);
    this.summarizer = opts.summarizer;
  }

  async processInput({ messages }: { messages: MastraDBMessage[] }): Promise<MastraDBMessage[]> {
    if (isAutoCompactDisabled()) return messages;

    const tokens = estimateTokens(messages);
    const autoThreshold = getAutoCompactThreshold();
    const overCount = messages.length > this.triggerAt;
    const overTokens = tokens > this.tokenTriggerAt;
    const overAutoWindow = tokens > autoThreshold;

    if (!overCount && !overTokens && !overAutoWindow) return messages;

    const head = messages.slice(0, messages.length - this.keepRecent);
    const tail = messages.slice(messages.length - this.keepRecent);
    if (head.length === 0) return messages;

    const useLlm =
      this.summarizer &&
      (messages.length > this.llmTriggerAt || tokens > this.tokenLlmTriggerAt || overAutoWindow);
    let summaryText: string;

    try {
      if (useLlm && this.summarizer) {
        const transcript = head
          .map((m) => `${(m as { role?: string }).role ?? 'msg'}: ${textOf(m)}`)
          .join('\n');
        try {
          const summary = await this.summarizer(transcript);
          summaryText =
            `[Conversation compacted (gen ${bumpCompactGeneration()}): the ${head.length} earlier message(s) were summarized below. ` +
            `Treat this as the authoritative record of that span and continue the task.]\n\n` +
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

    return [summaryMessage, ...tail];
  }

  private deterministic(head: MastraDBMessage[]): string {
    return (
      `[compacted ${head.length} earlier messages]\n` +
      head
        .map((m) => {
          const role = (m as { role?: string }).role ?? 'msg';
          return `- ${role}: ${textOf(m).slice(0, this.perMessageChars)}`;
        })
        .join('\n')
    );
  }
}
