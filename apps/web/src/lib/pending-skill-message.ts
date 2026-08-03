import type { UIMessage } from 'ai';
import { getChatSettings } from '@/lib/chat-settings';
import { stampMessageWithSentAt } from '@/lib/message-timestamp';

export const PENDING_SKILL_DATA_PART = 'data-veylin-pendingSkill';

export function readPendingSkillFromMessage(message: {
  metadata?: unknown;
  parts?: readonly unknown[];
  content?: readonly unknown[];
}): string | null {
  const custom = (message.metadata as { custom?: { pendingSkill?: string } } | undefined)?.custom;
  if (custom?.pendingSkill) return custom.pendingSkill;

  const sources = [message.parts, message.content];
  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const part of list) {
      if (!part || typeof part !== 'object') continue;
      const typed = part as { type?: string; name?: string; data?: { skill?: string } };
      if (typed.type === PENDING_SKILL_DATA_PART) {
        return typed.data?.skill ?? null;
      }
      if (typed.type === 'data' && typed.name === 'veylin-pendingSkill') {
        return typed.data?.skill ?? null;
      }
    }
  }
  return null;
}

/** Stamp pending /skill onto the outgoing user message for display + persistence. */
export function stampOutgoingUserMessage<T extends { metadata?: unknown; parts?: unknown[] }>(
  message: T,
): T {
  const stamped = stampMessageWithSentAt(message);
  const { pendingSkill } = getChatSettings();
  if (!pendingSkill) return stamped;

  const metadata = (stamped.metadata ?? {}) as Record<string, unknown>;
  const custom = (metadata.custom ?? {}) as Record<string, unknown>;
  const parts = [...(stamped.parts ?? [])];
  parts.push({
    type: PENDING_SKILL_DATA_PART,
    data: { skill: pendingSkill },
  });

  return {
    ...stamped,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        pendingSkill,
      },
    },
    parts,
  } as T;
}

export function stampOutgoingUiMessage<UI_MESSAGE extends UIMessage>(
  message: UI_MESSAGE,
): UI_MESSAGE {
  return stampOutgoingUserMessage(message);
}
