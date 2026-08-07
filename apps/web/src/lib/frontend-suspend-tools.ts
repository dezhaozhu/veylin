import type { UIMessage } from 'ai';
import { isToolUIPart } from 'ai';
import {
  getFrontendSuspendToolName,
  type FrontendSuspendToolName,
} from './frontend-suspend-tool-name';

export {
  FRONTEND_SUSPEND_TOOL_NAMES,
  getFrontendSuspendToolName,
  type FrontendSuspendToolName,
} from './frontend-suspend-tool-name';

type ToolPart = {
  type?: string;
  toolName?: string;
  state?: string;
  output?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: { type?: string };
  toolCallId?: string;
};

function toolPartOutput(part: ToolPart): unknown {
  return part.output !== undefined ? part.output : part.result;
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
  if (toolName === 'request_3d_selection') {
    return Array.isArray((output as { face_ids?: unknown } | null)?.face_ids);
  }
  if (!output || typeof output !== 'object') return false;
  const result = output as {
    content?: string;
    error?: string;
    url?: string;
    title?: string;
    mode?: string;
  };
  return (
    typeof result.content === 'string' ||
    typeof result.url === 'string' ||
    typeof result.title === 'string' ||
    typeof result.error === 'string' ||
    result.mode === 'text' ||
    result.mode === 'html'
  );
}

export function isAwaitingFrontendToolPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const toolName = getFrontendSuspendToolName(part as ToolPart);
  if (!toolName) return false;
  const p = part as ToolPart;
  if (typeof p.state !== 'string') {
    if (p.status?.type === 'incomplete' || p.isError) return false;
    return !hasFrontendToolOutput(toolName, toolPartOutput(p));
  }
  if (p.state === 'input-streaming') return false;
  if (p.state === 'input-available') return true;
  if (p.state !== 'output-available') return false;
  return !hasFrontendToolOutput(toolName, toolPartOutput(p));
}

export function findFirstAwaitingFrontendToolIndex(
  parts: readonly unknown[] | undefined,
): number {
  if (!parts) return -1;
  return parts.findIndex(isAwaitingFrontendToolPart);
}

export function isAwaitingFrontendToolAnswer(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return false;
  return findFirstAwaitingFrontendToolIndex(last.parts) >= 0;
}

/**
 * Decides only whether an interrupted HTTP stream should reconnect. A native
 * tool suspension has already ended its stream and must wait for an explicit
 * resume request instead.
 */
export function conversationAwaitsResume(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last) return false;
  if (last.role === 'user') return true;
  if (last.role !== 'assistant') return false;
  const parts = last.parts ?? [];
  if (parts.some((part) => part.type === 'data-tool-call-suspended')) return false;
  if (parts.length === 0) return true;
  return parts.some((part) => {
    if (!isToolUIPart(part as never)) return false;
    const state = (part as { state?: string }).state;
    return (
      state === 'input-streaming' ||
      state === 'input-available' ||
      state === 'approval-requested'
    );
  });
}

export function pendingFrontendToolCallId(
  message: { id: string; parts?: readonly unknown[] },
  partIndex: number,
  part: ToolPart,
): string {
  return part.toolCallId ?? `${message.id}:${partIndex}`;
}
