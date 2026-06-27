import type { UIMessage } from 'ai';
import { sliceMessagesUntil } from '../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/utils/sliceMessagesUntil';

/**
 * Linear edit: drop the edited message, everything after it, and any consecutive
 * user messages immediately before it (duplicate sends without an assistant reply).
 */
export function sliceMessagesForLinearEdit<UI_MESSAGE extends UIMessage>(
  messages: UI_MESSAGE[],
  sourceId: string | null | undefined,
  parentId: string | null | undefined,
): UI_MESSAGE[] {
  if (!sourceId) {
    return sliceMessagesUntil(messages, parentId ?? null);
  }

  const editIdx = messages.findIndex((message) => message.id === sourceId);
  if (editIdx === -1) {
    return sliceMessagesUntil(messages, parentId ?? null);
  }

  let cutEnd = editIdx - 1;
  while (cutEnd >= 0 && messages[cutEnd]?.role !== 'assistant') {
    cutEnd--;
  }

  return messages.slice(0, cutEnd + 1);
}
