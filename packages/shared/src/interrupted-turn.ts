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

/** 这个部件是不是一个**还没拿到结果**的工具调用。 */
function isAwaitingToolPart(part: unknown): boolean {
  if (!isRecord(part)) return false;
  const type = typeof part.type === 'string' ? part.type : '';
  if (!type.startsWith('tool-')) return false;
  const state = typeof part.state === 'string' ? part.state : '';
  return state === 'input-available' || state === 'input-streaming' || state === 'approval-requested';
}

export const UNANSWERED_TOOL_NOTE =
  '(上一轮问的那个问题没有被回答 —— 用户直接回复了下面这条消息。按他说的继续,需要的话再问一次。)';

/**
 * 前端工具挂起(如 ask_user_question)之后,用户**没点那个问题、直接打字回复**时,
 * 把那条悬空的工具调用摘掉。
 *
 * 实测卡死的场景:agent 问了一句就挂起,用户打字回"好了,我绑好文件夹了",之后每一轮
 * assistant 都只产出一个空 step —— 界面上就是"我说了话,它不理我",而且永远不会自己
 * 恢复。根因就是那条没被回答的 tool call 一直留在历史里,每次调模型都带着它。
 *
 * 上面那条 stripper 只管客户端标了 `interrupted` 的 turn,不管这种。
 *
 * **摘掉之后要留一句话说明**:不说的话,模型不知道那个问题是被跳过了还是从没问过,
 * 于是可能傻乎乎再问一遍同样的问题。
 * **没有后续用户消息就不动** —— 那是正常在等人回答,不是卡住。
 */
export function stripUnansweredToolCallsForAgent<T extends UiMessageLike>(messages: T[]): T[] {
  return messages.map((message, i) => {
    if (message.role !== 'assistant' || !Array.isArray(message.parts)) return message;
    if (!message.parts.some(isAwaitingToolPart)) return message;
    if (!messages.slice(i + 1).some(isRealUserFollowUp)) return message;

    const kept = message.parts.filter(
      (p) => !isAwaitingToolPart(p) && !(isRecord(p) && p.type === 'data-tool-call-suspended'),
    );
    return { ...message, parts: [...kept, { type: 'text', text: UNANSWERED_TOOL_NOTE }] };
  });
}
