import { getChatSettings } from '@/lib/chat-settings';
import { placeComposerCaret } from '@/lib/composer-caret';

export type PendingSkillSelection = {
  text: string;
  insertAt: number;
  cursor: number;
};

/**
 * Claude Code / OpenHands style: slash picks activate a pending skill without
 * leaving a styled token inside the textarea (avoids mirror-layer IME bugs).
 */
export function commitPendingSkillSelection(
  setText: (text: string) => void,
  setPendingSkill: (name: string, insertAt: number) => void,
  currentText: string,
  skillName: string,
  replaceStart: number,
  replaceEnd: number,
): PendingSkillSelection {
  const text = currentText.slice(0, replaceStart) + currentText.slice(replaceEnd);
  const insertAt = replaceStart;
  setText(text);
  setPendingSkill(skillName, insertAt);
  placeComposerCaret(insertAt);
  return { text, insertAt, cursor: insertAt };
}

/** Append pending skill at end of composer (e.g. + menu). */
export function commitPendingSkillAtEnd(
  setText: (text: string) => void,
  setPendingSkill: (name: string, insertAt: number) => void,
  currentText: string,
  skillName: string,
): PendingSkillSelection {
  const trimmed = currentText.replace(/[\n\r]+$/, '');
  const needsSpace = trimmed.length > 0 && !trimmed.endsWith(' ');
  const text = needsSpace ? `${trimmed} ` : trimmed;
  const insertAt = text.length;
  setText(text);
  setPendingSkill(skillName, insertAt);
  placeComposerCaret(insertAt);
  return { text, insertAt, cursor: insertAt };
}

export function currentPendingSkillName(): string | null {
  return getChatSettings().pendingSkill;
}
