import type { UIMessage } from 'ai';
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai';

/** Tools completed on the client; the server must not finish the same run. */
export const FRONTEND_SUSPEND_TOOL_NAMES = ['ask_user_question', 'read_open_page'] as const;

export type FrontendSuspendToolName = (typeof FRONTEND_SUSPEND_TOOL_NAMES)[number];

type ToolPart = {
  type?: string;
  state?: string;
  output?: unknown;
  toolCallId?: string;
};

export function getFrontendSuspendToolName(part: ToolPart): FrontendSuspendToolName | null {
  const type = part.type;
  if (!type?.startsWith('tool-')) return null;
  const name = type.slice('tool-'.length);
  return FRONTEND_SUSPEND_TOOL_NAMES.includes(name as FrontendSuspendToolName)
    ? (name as FrontendSuspendToolName)
    : null;
}

export function hasAskUserAnswers(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false;
  const answers = (output as { answers?: unknown }).answers;
  return (
    Boolean(answers) &&
    typeof answers === 'object' &&
    Object.keys(answers as Record<string, unknown>).length > 0
  );
}

export function hasFrontendToolOutput(
  toolName: FrontendSuspendToolName,
  output: unknown,
): boolean {
  if (toolName === 'ask_user_question') return hasAskUserAnswers(output);
  if (!output || typeof output !== 'object') return false;
  const result = output as { content?: string; error?: string };
  return Boolean(result.content?.length || result.error?.length);
}

export function isAwaitingFrontendToolPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const toolName = getFrontendSuspendToolName(part as ToolPart);
  if (!toolName) return false;
  const p = part as ToolPart;
  if (p.state !== 'output-available') return true;
  return !hasFrontendToolOutput(toolName, p.output);
}

export function findFirstAwaitingFrontendToolIndex(parts: unknown[] | undefined): number {
  if (!parts) return -1;
  return parts.findIndex(isAwaitingFrontendToolPart);
}

/** Whether the chat runtime may auto-send the next model turn. */
export function shouldAutoSendChat({
  messages,
}: {
  messages: UIMessage[];
}): boolean {
  const last = messages.at(-1);
  if (last?.role === 'assistant' && last.parts?.length) {
    for (const part of last.parts) {
      if (isAwaitingFrontendToolPart(part)) return false;
    }
  }
  return lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

export function trimAssistantAfterAwaitingTool<T extends { id: string; role: string; parts?: unknown[] }>(
  messages: readonly T[],
): T[] | null {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.parts?.length) return null;

  const pendingIndex = findFirstAwaitingFrontendToolIndex(last.parts);
  if (pendingIndex < 0 || pendingIndex >= last.parts.length - 1) return null;

  return messages.map((message) =>
    message.id === last.id
      ? ({ ...message, parts: message.parts!.slice(0, pendingIndex + 1) } as T)
      : message,
  );
}

export function pendingFrontendToolCallId(
  message: { id: string; parts?: unknown[] },
  partIndex: number,
  part: ToolPart,
): string {
  return part.toolCallId ?? `${message.id}:${partIndex}`;
}
