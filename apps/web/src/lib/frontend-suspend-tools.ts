import type { UIMessage } from 'ai';
import { isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { assistantDispatchedBackgroundWorkers } from './background-task-continuation';

/** Tools completed on the client; the server must not finish the same run. */
export const FRONTEND_SUSPEND_TOOL_NAMES = ['ask_user_question', 'read_open_page'] as const;

export type FrontendSuspendToolName = (typeof FRONTEND_SUSPEND_TOOL_NAMES)[number];

type ToolPart = {
  type?: string;
  state?: string;
  output?: unknown;
  toolCallId?: string;
};

const frontendToolStopPromises = new Map<string, Promise<unknown>>();

/** Sentinel key for awaiting the in-flight chat run stop (not tied to a tool call). */
const STREAM_STOP_KEY = '__chat_run__';

export function registerStreamStop(promise: Promise<unknown>): void {
  registerFrontendToolStop(STREAM_STOP_KEY, promise);
}

export async function waitForStreamStop(): Promise<void> {
  const pending = frontendToolStopPromises.get(STREAM_STOP_KEY);
  if (pending) await pending;
}

export function registerFrontendToolStop(toolCallId: string, promise: Promise<unknown>): void {
  frontendToolStopPromises.set(toolCallId, promise);
  void promise.finally(() => {
    if (frontendToolStopPromises.get(toolCallId) === promise) {
      frontendToolStopPromises.delete(toolCallId);
    }
  });
}

export async function waitForFrontendToolStop(toolCallId: string): Promise<void> {
  await frontendToolStopPromises.get(toolCallId);
}

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
  const result = output as {
    content?: string;
    error?: string;
    url?: string;
    title?: string;
    mode?: string;
  };
  if (typeof result.error === 'string' && result.error.length > 0) return true;
  // Empty page is still a successful read (about:blank) � accept url/title/mode/content.
  if (typeof result.content === 'string') return true;
  if (typeof result.url === 'string') return true;
  if (typeof result.title === 'string') return true;
  if (result.mode === 'text' || result.mode === 'html') return true;
  return false;
}

export function isAwaitingFrontendToolPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const toolName = getFrontendSuspendToolName(part as ToolPart);
  if (!toolName) return false;
  const p = part as ToolPart;
  // Wait until tool args finish streaming before suspending the run or showing UI.
  if (p.state === 'input-streaming') return false;
  if (p.state === 'input-available') return true;
  if (p.state !== 'output-available') return false;
  return !hasFrontendToolOutput(toolName, p.output);
}

export function findFirstAwaitingFrontendToolIndex(parts: unknown[] | undefined): number {
  if (!parts) return -1;
  return parts.findIndex(isAwaitingFrontendToolPart);
}

/** Last assistant message is blocked on a client-side suspend tool (e.g. ask_user_question). */
export function isAwaitingFrontendToolAnswer(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.parts?.length) return false;
  return findFirstAwaitingFrontendToolIndex(last.parts) >= 0;
}

/**
 * Whether the latest turn is genuinely mid-flight and therefore a candidate for
 * resuming a server stream after a reload.
 *
 * A *completed* assistant reply (final text, every tool resolved, nothing awaiting)
 * must NOT be resumed: the server's `activity === 'running'` signal can be stale (a
 * lingering active-stream mapping within its TTL, or a non-terminal background task
 * row on the parent thread), and re-attaching there makes a finished conversation
 * look like it started streaming again. The visible message state is the authority.
 */
export function conversationAwaitsResume(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last) return false;
  // Assistant has not answered the latest user turn yet.
  if (last.role === 'user') return true;
  if (last.role !== 'assistant') return false;

  const parts = last.parts ?? [];
  // An empty assistant placeholder is a freshly-created, not-yet-streamed turn.
  if (parts.length === 0) return true;

  // A tool whose output has not arrived means the run was cut mid-step.
  for (const part of parts) {
    if (!isToolUIPart(part as never)) continue;
    const state = (part as { state?: string }).state;
    if (
      state === 'input-streaming' ||
      state === 'input-available' ||
      state === 'approval-requested'
    ) {
      return true;
    }
  }

  // Blocked on a client-side suspend tool answer.
  return isAwaitingFrontendToolAnswer(messages);
}

function lastStepParts(message: UIMessage): unknown[] {
  const parts = message.parts ?? [];
  const lastStepStartIndex = parts.reduce((lastIndex, part, index) => {
    return part.type === 'step-start' ? index : lastIndex;
  }, -1);
  return parts.slice(lastStepStartIndex + 1);
}

function isToolPartComplete(part: unknown): boolean {
  if (!isToolUIPart(part as never)) return true;
  const toolPart = part as { state?: string };
  return toolPart.state === 'output-available' || toolPart.state === 'output-error';
}

/** True when the model already produced a user-facing reply after the tool. */
function hasAssistantReplyAfter(parts: unknown[], afterIndex: number): boolean {
  let stepStartAfterTool = -1;
  for (let i = afterIndex + 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || typeof part !== 'object') continue;
    if ((part as { type?: string }).type === 'step-start') {
      stepStartAfterTool = i;
    }
  }
  if (stepStartAfterTool < 0) return false;

  for (let i = stepStartAfterTool + 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || typeof part !== 'object') continue;
    const type = (part as { type?: string }).type;
    if (type === 'step-start') continue;
    if (type === 'text' && (part as { text?: string }).text?.trim()) return true;
  }
  return false;
}

/**
 * Server-started frontend tools set `providerExecuted`, which makes
 * `lastAssistantMessageIsCompleteWithToolCalls` ignore them. After the client
 * fills in answers we must still auto-continue the chat.
 */
function findLastCompletedFrontendSuspendToolIndex(parts: unknown[]): number {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    const toolName = getFrontendSuspendToolName(part as ToolPart);
    if (!toolName) continue;
    if (!isToolPartComplete(part)) return -1;
    const p = part as ToolPart;
    if (!hasFrontendToolOutput(toolName, p.output)) return -1;
    return i;
  }
  return -1;
}

function messageNeedsFrontendSuspendContinuation(parts: unknown[]): boolean {
  const toolIndex = findLastCompletedFrontendSuspendToolIndex(parts);
  if (toolIndex < 0) return false;
  return !hasAssistantReplyAfter(parts, toolIndex);
}

/**
 * The last assistant message has a *completed* client-side suspend tool (answered
 * ask_user_question / read_open_page) with no follow-up reply. This is the only
 * thing that can wedge a still-streaming run: in-progress server tools (subagent
 * `task`, `web_fetch`) legitimately hold the stream open and must never be treated
 * as "stuck".
 */
export function needsFrontendSuspendContinuation(messages: UIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.parts?.length) return false;
  for (const part of last.parts) {
    if (isAwaitingFrontendToolPart(part)) return false;
  }
  return messageNeedsFrontendSuspendContinuation(last.parts);
}

/**
 * Whether the chat runtime may auto-send the next model turn.
 *
 * The ONLY client-driven continuation is a frontend-suspend tool whose result the
 * client just produced (ask_user_question / read_open_page) — the server has no
 * other way to learn that result, so a follow-up POST is required.
 *
 * Server-executed tools (subagent `task`, web_fetch, knowledge_search, table reads)
 * run to completion *inside* the server agent loop and the model continues there in
 * the same stream. A dropped connection is recovered by resumable GET resume, never
 * by a client re-POST — re-POSTing starts a brand-new run, which restarts the turn
 * from scratch and makes the model loop ("read table → dispatch → read table → …").
 * So we never auto-continue for a server tool.
 */
export function shouldAutoSendChat({
  messages,
}: {
  messages: UIMessage[];
  /** Accepted for call-site compatibility; no longer affects the decision. */
  status?: string;
}): boolean {
  const last = messages.at(-1);
  if (last?.role === 'assistant' && last.parts?.length) {
    for (const part of last.parts) {
      if (isAwaitingFrontendToolPart(part)) return false;
    }

    const stepParts = lastStepParts(last);
    const pendingClientTools = stepParts.filter(
      (part) =>
        isToolUIPart(part as never) &&
        !(part as { providerExecuted?: boolean }).providerExecuted &&
        !getFrontendSuspendToolName(part as ToolPart),
    );
    const clientToolsReady =
      pendingClientTools.length === 0 ||
      pendingClientTools.every(isToolPartComplete);

    if (!clientToolsReady) {
      return false;
    }

    if (assistantDispatchedBackgroundWorkers(last)) {
      return false;
    }

    if (messageNeedsFrontendSuspendContinuation(last.parts)) {
      return true;
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
