import type { ThreadMessage } from '@assistant-ui/react';
import { isTaskNotificationText } from '@veylin/shared';
import { splitQuotedPrefix } from './thread-selection-ask';

export type ThreadQuestionItem = {
  id: string;
  label: string;
};

const MAX_LABEL_LENGTH = 48;

export function readUserMessageText(message: ThreadMessage): string {
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function collectThreadQuestions(
  messages: readonly ThreadMessage[],
): ThreadQuestionItem[] {
  const items: ThreadQuestionItem[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = readUserMessageText(message);
    if (!text || isTaskNotificationText(text)) continue;
    const { quote, body } = splitQuotedPrefix(text);
    const labelSource = body.trim() || quote || text;
    items.push({
      id: message.id,
      label: truncateQuestionLabel(labelSource),
    });
  }
  return items;
}

export function truncateQuestionLabel(text: string, max = MAX_LABEL_LENGTH): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max - 1)}…`;
}

export const THREAD_QUESTION_RAIL_MIN_COUNT = 1;
