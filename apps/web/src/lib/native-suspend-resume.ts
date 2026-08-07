import type { UIMessage } from 'ai';

export type NativeToolSuspension = {
  runId: string;
  toolCallId: string;
  toolName: string;
  suspendPayload: unknown;
  state?: string;
  suspendedAt?: number;
};

export type NativeResumeRequest = {
  threadId: string;
  runId: string;
  toolCallId: string;
  resumeData: unknown;
};

type DataPart = {
  type?: string;
  data?: {
    runId?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    suspendPayload?: unknown;
    state?: unknown;
    suspendedAt?: unknown;
  };
};

/**
 * Mastra emits a durable AI SDK data part next to the suspended tool call.
 * Reading this part, rather than inferring state from text/tool output, gives the
 * client the exact identity required to resume the same run.
 */
export function findNativeToolSuspension(
  messages: readonly Pick<UIMessage, 'role' | 'parts'>[],
  toolCallId?: string,
): NativeToolSuspension | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role === 'user') break;
    if (message?.role !== 'assistant') continue;
    const parts = message.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex] as DataPart;
      if (part.type !== 'data-tool-call-suspended') continue;
      const data = part.data;
      if (
        typeof data?.runId !== 'string' ||
        typeof data.toolCallId !== 'string' ||
        typeof data.toolName !== 'string'
      ) {
        continue;
      }
      if (toolCallId && data.toolCallId !== toolCallId) continue;
      return {
        runId: data.runId,
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        suspendPayload: data.suspendPayload,
        ...(typeof data.state === 'string' ? { state: data.state } : {}),
        ...(typeof data.suspendedAt === 'number' ? { suspendedAt: data.suspendedAt } : {}),
      };
    }
  }
  return null;
}

const pendingByThread = new Map<string, NativeResumeRequest>();

export function stageNativeResumeRequest(request: NativeResumeRequest): void {
  pendingByThread.set(request.threadId, request);
}

export function discardNativeResumeRequest(threadId: string): void {
  pendingByThread.delete(threadId);
}

/** Consumed exactly once by AssistantChatTransport. Failed sends re-stage it. */
export function consumeNativeResumeRequest(
  threadId: string,
): NativeResumeRequest | null {
  let request = pendingByThread.get(threadId);
  if (!request && pendingByThread.size === 1) {
    // assistant-ui can replace a local list-item id with its remote id while a
    // request is being prepared. There can only be one active composer send.
    request = pendingByThread.values().next().value;
  }
  if (!request) return null;
  pendingByThread.delete(request.threadId);
  return request;
}
