import type { AskQuestion, AskUserResult } from '@/lib/ask-user-question-session';

export const ASK_OTHER_OPTION = '__other__';

/** Stable answer keys from headers; disambiguate duplicates within one call. */
export function answerKeysForQuestions(questions: AskQuestion[]): string[] {
  const seen = new Map<string, number>();
  return questions.map((q) => {
    const base = (q.header || '').trim() || q.question;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

/** Resolve answer for a question: prefer header key, fall back to full question (legacy). */
export function lookupAskAnswer(
  answers: Record<string, string> | undefined,
  question: AskQuestion,
  answerKey?: string,
): string | undefined {
  if (!answers) return undefined;
  const key = answerKey ?? ((question.header || '').trim() || question.question);
  if (answers[key] !== undefined) return answers[key];
  if (answers[question.question] !== undefined) return answers[question.question];
  return undefined;
}

export function buildAskUserResult(
  questions: AskQuestion[],
  picks: Record<number, string[]>,
  others: Record<number, string>,
): AskUserResult {
  const answers: Record<string, string> = {};
  const annotations: Record<string, { preview?: string }> = {};
  const keys = answerKeysForQuestions(questions);

  questions.forEach((q, qi) => {
    const key = keys[qi]!;
    const chosen = (picks[qi] ?? []).map((label) =>
      label === ASK_OTHER_OPTION ? (others[qi] || '').trim() || 'Other' : label,
    );
    answers[key] = chosen.join(', ') || '(no answer)';
    for (const label of chosen) {
      const opt = q.options.find((o) => o.label === label);
      if (opt?.preview) {
        annotations[key] = { preview: opt.preview };
        break;
      }
    }
  });

  return { questions, answers, annotations };
}

export function buildSkippedAskUserResult(questions: AskQuestion[]): AskUserResult {
  const answers: Record<string, string> = {};
  const keys = answerKeysForQuestions(questions);
  questions.forEach((_, qi) => {
    answers[keys[qi]!] = '(skipped)';
  });
  return { questions, answers };
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
