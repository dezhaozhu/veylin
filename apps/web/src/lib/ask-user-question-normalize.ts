import type { AskQuestion } from '@/lib/ask-user-question-session';

interface Option {
  label: string;
  description?: string;
  preview?: string;
}

type RawQuestion = Partial<AskQuestion> & {
  prompt?: unknown;
  text?: unknown;
  choices?: unknown;
};

function normalizeQuestion(raw: RawQuestion | undefined): AskQuestion | null {
  if (!raw) return null;

  const questionText = (
    typeof raw.question === 'string'
      ? raw.question
      : typeof raw.prompt === 'string'
        ? raw.prompt
        : typeof raw.text === 'string'
          ? raw.text
          : ''
  ).trim();
  if (!questionText) return null;

  const header =
    (typeof raw.header === 'string' ? raw.header.trim() : '') ||
    questionText.slice(0, 12);

  const rawOptions = Array.isArray(raw.options)
    ? raw.options
    : Array.isArray(raw.choices)
      ? raw.choices
      : [];

  const options = rawOptions
    .map((entry): Option | null => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        return label ? { label } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const o = entry as Record<string, unknown>;
      const label = (
        typeof o.label === 'string'
          ? o.label
          : typeof o.text === 'string'
            ? o.text
            : typeof o.value === 'string'
              ? o.value
              : ''
      ).trim();
      if (!label) return null;
      return {
        label,
        description: typeof o.description === 'string' ? o.description : undefined,
        preview: typeof o.preview === 'string' ? o.preview : undefined,
      };
    })
    .filter((o): o is Option => o != null);

  if (options.length === 0) return null;

  return {
    question: questionText,
    header,
    options,
    multiSelect: raw.multiSelect ?? false,
  };
}

export function normalizeAskQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeQuestion(item as RawQuestion)).filter((q): q is AskQuestion => q != null);
}
