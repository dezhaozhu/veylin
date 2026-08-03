import { isTaskNotificationText } from './task-notification.js';

export const INTERRUPTED_TURN_NOTE =
  'Previous assistant turn was interrupted by the user. Respond to the latest user message; do not repeat earlier status updates or tool narration from the interrupted turn.';

type UiMessageLike = {
  id?: string;
  role: string;
  content?: string;
  parts?: unknown[];
  metadata?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function userText(message: UiMessageLike): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }
  if (!message.parts) return '';
  return message.parts
    .filter((p): p is { type: string; text?: string } => isRecord(p) && p.type === 'text')
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

/** True when the client marked this assistant turn as user-interrupted. */
export function isInterruptedAssistantMessage(message: UiMessageLike): boolean {
  if (message.role !== 'assistant') return false;
  if (!isRecord(message.metadata)) return false;
  const custom = message.metadata.custom;
  if (!isRecord(custom)) return false;
  return custom.interrupted === true;
}

function isRealUserFollowUp(message: UiMessageLike): boolean {
  if (message.role !== 'user') return false;
  const text = userText(message);
  if (!text) return true;
  return !isTaskNotificationText(text);
}

/**
 * For agent context only: after a real user follow-up, replace interrupted
 * assistant narratives with a short note so the model does not replay them.
 * UI transcript should keep the original bubble.
 */
export function stripInterruptedAssistantTurnsForAgent<T extends UiMessageLike>(
  messages: T[],
): T[] {
  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (!isInterruptedAssistantMessage(message)) {
      out.push(message);
      continue;
    }

    const hasFollowUp = messages.slice(i + 1).some(isRealUserFollowUp);
    if (!hasFollowUp) {
      out.push(message);
      continue;
    }

    out.push({
      ...message,
      content: INTERRUPTED_TURN_NOTE,
      parts: [{ type: 'text', text: INTERRUPTED_TURN_NOTE }],
    });
  }
  return out;
}
