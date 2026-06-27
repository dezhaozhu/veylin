import type { UIMessage } from 'ai';
import { isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';

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

export function registerFrontendToolStop(toolCallId: string, promise: Promise<unknown>): void {
  frontendToolStopPromises.set(toolCallId, promise);
  void promise.finally(() => {
    if (frontendToolStopPromises.get(toolCallId) === promise) {
      frontendToolStopPromises.delete(toolCallId);
    }
  });
}

export async function waitForFrontendToolStop(toolCallId: string): Promise<void> {
  await frontendToolStopPromises.get(toolCallId)?.catch(() => undefined);
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
  const result = output as { content?: string; error?: string };
  return Boolean(result.content?.length || result.error?.length);
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

/**
 * Server-started frontend tools set `providerExecuted`, which makes
 * `lastAssistantMessageIsCompleteWithToolCalls` ignore them. After the client
 * fills in answers we must still auto-continue the chat.
 */
function frontendSuspendToolsReadyInStep(stepParts: unknown[]): boolean {
  const frontendParts = stepParts.filter((part) =>
    getFrontendSuspendToolName(part as ToolPart),
  );
  if (frontendParts.length === 0) return false;
  return frontendParts.every((part) => {
    const toolName = getFrontendSuspendToolName(part as ToolPart)!;
    const p = part as ToolPart;
    return isToolPartComplete(part) && hasFrontendToolOutput(toolName, p.output);
  });
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

    if (frontendSuspendToolsReadyInStep(stepParts) && clientToolsReady) {
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
