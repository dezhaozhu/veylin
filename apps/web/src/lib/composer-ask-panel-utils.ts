import type { AskQuestion, AskUserResult } from '@/lib/ask-user-question-session';

export const ASK_OTHER_OPTION = '__other__';

export function buildAskUserResult(
  questions: AskQuestion[],
  picks: Record<number, string[]>,
  others: Record<number, string>,
): AskUserResult {
  const answers: Record<string, string> = {};
  const annotations: Record<string, { preview?: string }> = {};

  questions.forEach((q, qi) => {
    const chosen = (picks[qi] ?? []).map((label) =>
      label === ASK_OTHER_OPTION ? (others[qi] || '').trim() || 'Other' : label,
    );
    answers[q.question] = chosen.join(', ') || '(no answer)';
    for (const label of chosen) {
      const opt = q.options.find((o) => o.label === label);
      if (opt?.preview) {
        annotations[q.question] = { preview: opt.preview };
        break;
      }
    }
  });

  return { questions, answers, annotations };
}

export function hasStepAnswer(selected: string[], other: string): boolean {
  if (selected.length === 0) return false;
  if (selected.includes(ASK_OTHER_OPTION) && !other.trim()) return false;
  return true;
}

export function allStepsAnswered(
  questions: AskQuestion[],
  picks: Record<number, string[]>,
  others: Record<number, string>,
): boolean {
  return questions.every((_, qi) => hasStepAnswer(picks[qi] ?? [], others[qi] ?? ''));
}
