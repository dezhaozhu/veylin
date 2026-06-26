import type { ThreadMessage } from '@assistant-ui/core';
import { getExternalStoreMessages } from '@assistant-ui/core';
import type { UIMessage } from 'ai';

export type BranchExportLike = {
  headId?: string | null;
  messages: ReadonlyArray<{
    message: ThreadMessage;
    parentId: string | null;
  }>;
};

/** Walk exported repository head → root for branch picker / setMessages sync. */
export function getActiveBranchThreadMessages(exported: BranchExportLike): ThreadMessage[] {
  const headId = exported.headId;
  if (!headId) return [];

  const byId = new Map<string, ThreadMessage>();
  const parentById = new Map<string, string | null>();
  for (const { message, parentId } of exported.messages) {
    byId.set(message.id, message);
    parentById.set(message.id, parentId);
  }

  const path: ThreadMessage[] = [];
  const seen = new Set<string>();
  let currentId: string | null = headId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const message = byId.get(currentId);
    if (!message) break;
    path.unshift(message);
    currentId = parentById.get(currentId) ?? null;
  }
  return path;
}

function isThreadMessage(value: unknown): value is ThreadMessage {
  return (
    typeof value === 'object' &&
    value != null &&
    'content' in value &&
    Array.isArray((value as ThreadMessage).content)
  );
}

export function isThreadMessageInput(input: readonly unknown[]): input is readonly ThreadMessage[] {
  return input.length > 0 && isThreadMessage(input[0]);
}

function threadMessageToUiMessage(message: ThreadMessage): UIMessage | null {
  const parts: UIMessage['parts'] = [];

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        if (part.text.length > 0) parts.push({ type: 'text', text: part.text });
        break;
      case 'reasoning':
        if (part.text.length > 0) {
          parts.push({ type: 'reasoning', text: part.text });
        }
        break;
      case 'file':
        parts.push({
          type: 'file',
          mediaType: part.mimeType,
          url: part.data,
          ...(part.filename ? { filename: part.filename } : {}),
        });
        break;
      case 'tool-call':
        parts.push({
          type: `tool-${part.toolName}`,
          toolCallId: part.toolCallId,
          state: 'output-available',
          input: part.args,
          output: part.result,
        } as UIMessage['parts'][number]);
        break;
      default:
        break;
    }
  }

  if (parts.length === 0) return null;

  return {
    id: message.id,
    role: message.role as UIMessage['role'],
    parts,
  };
}

/** Resolve assistant-ui thread messages to AI SDK UI messages for branch switching. */
export function resolveThreadMessagesToUi<UI_MESSAGE extends UIMessage>(
  threadMessages: readonly ThreadMessage[],
  fallbackById: ReadonlyMap<string, UI_MESSAGE>,
): UI_MESSAGE[] {
  return threadMessages.flatMap((message) => {
    const bound = getExternalStoreMessages<UI_MESSAGE>(message);
    if (bound.length > 0) return bound;

    const cached = fallbackById.get(message.id);
    if (cached) return [cached];

    const reconstructed = threadMessageToUiMessage(message);
    return reconstructed ? [reconstructed as UI_MESSAGE] : [];
  });
}
