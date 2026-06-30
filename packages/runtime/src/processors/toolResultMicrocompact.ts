import type { Processor } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/memory';

const CLEARED_PLACEHOLDER =
  '[Earlier tool result cleared — key facts should be in assistant text]';

/** Read-only tools whose large outputs are safe to trim from old turns. */
export const MICROCOMPACT_TOOL_WHITELIST = new Set([
  'knowledge_search',
  'web_fetch',
  'table_get',
  'table_list_sheets',
  'read_open_page',
  'tool_search',
]);

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

type ContentPart = { type: string; text?: string; toolName?: string; [key: string]: unknown };

function partsOf(message: MastraDBMessage): ContentPart[] {
  const parts = (message as { content?: { parts?: ContentPart[] } }).content?.parts;
  return parts ?? [];
}

function isAssistantToolCall(message: MastraDBMessage): boolean {
  const role = (message as { role?: string }).role;
  if (role !== 'assistant') return false;
  return partsOf(message).some((p) => p.type === 'tool-call' || p.type === 'tool-invocation');
}

function isToolResultMessage(message: MastraDBMessage): boolean {
  const role = (message as { role?: string }).role;
  if (role === 'tool') return true;
  return partsOf(message).some((p) => p.type === 'tool-result');
}

function toolNameFromMessage(message: MastraDBMessage): string | null {
  for (const p of partsOf(message)) {
    if (typeof p.toolName === 'string' && p.toolName) return p.toolName;
    if (p.type === 'tool-result' && typeof (p as unknown as { name?: string }).name === 'string') {
      return (p as unknown as { name: string }).name;
    }
  }
  return null;
}

function compactToolResultParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((p) => {
    if (p.type === 'tool-result' || p.type === 'text') {
      if (p.type === 'text' && !p.text) return p;
      return { ...p, text: CLEARED_PLACEHOLDER };
    }
    return p;
  });
}

let microcompactGeneration = 0;

export function resetMicrocompactState(): void {
  microcompactGeneration += 1;
}

export function getMicrocompactGeneration(): number {
  return microcompactGeneration;
}

/**
 * Trims old tool-result payloads while keeping recent assistant rounds intact.
 * Runs before full conversation compaction.
 */
export class ToolResultMicrocompact implements Processor {
  id = 'tool-result-microcompact';
  private keepRounds: number;

  constructor(opts: { keepRounds?: number } = {}) {
    this.keepRounds = opts.keepRounds ?? envInt('VEYLIN_MC_KEEP_ROUNDS', 3);
  }

  async processInput({ messages }: { messages: MastraDBMessage[] }): Promise<MastraDBMessage[]> {
    if (messages.length === 0) return messages;

    const assistantRoundIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (isAssistantToolCall(messages[i]!)) assistantRoundIndices.push(i);
    }
    if (assistantRoundIndices.length <= this.keepRounds) return messages;

    const keepFrom =
      assistantRoundIndices[assistantRoundIndices.length - this.keepRounds] ?? 0;

    return messages.map((message, index) => {
      if (index >= keepFrom) return message;
      if (!isToolResultMessage(message)) return message;

      const toolName = toolNameFromMessage(message);
      if (toolName && !MICROCOMPACT_TOOL_WHITELIST.has(toolName)) return message;

      const parts = partsOf(message);
      if (parts.length === 0) return message;

      const text = parts
        .filter((p) => p.type === 'text' || p.type === 'tool-result')
        .map((p) => p.text ?? '')
        .join('');
      if (text === CLEARED_PLACEHOLDER || text.length < 80) return message;

      return {
        ...message,
        content: {
          ...(message as { content?: object }).content,
          parts: compactToolResultParts(parts),
        },
      } as MastraDBMessage;
    });
  }
}
