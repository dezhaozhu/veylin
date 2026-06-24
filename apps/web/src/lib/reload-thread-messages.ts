import type { AssistantClient } from '@assistant-ui/store';
import type { ThreadMessage } from '@assistant-ui/core';
import type { UIMessage } from 'ai';
import { storedMessageToUiMessage } from '@/lib/server-thread-history-adapter';
import { toExportedMessageRepository } from '@/lib/use-external-history';
import { AISDKMessageConverter } from '../../../../node_modules/@assistant-ui/react-ai-sdk/src/ui/utils/convertMessage';

export type ReloadableMessage = {
  id?: string;
  role: string;
  content?: string;
  parts?: unknown[];
};

/** Replace the active thread messages from a server snapshot (compact / sync). */
export function reloadThreadFromServer(
  aui: AssistantClient,
  messages: ReloadableMessage[],
): void {
  let parentId: string | null = null;
  const formatItems = messages.map((msg) => {
    const uiMessage = storedMessageToUiMessage(msg);
    const item = { parentId, message: uiMessage };
    parentId = uiMessage.id;
    return item;
  });

  const converted = toExportedMessageRepository(
    AISDKMessageConverter.toThreadMessages as (messages: UIMessage[]) => ThreadMessage[],
    {
      messages: formatItems,
      ...(parentId != null ? { headId: parentId } : {}),
    },
  );

  aui.thread().import(converted);
}
