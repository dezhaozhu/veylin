import { makeAssistantToolUI } from '@assistant-ui/react';
import { HelpCircleIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  hasAskUserAnswers,
  setAskUserSession,
  type AskQuestion,
  type AskUserResult,
} from '@/lib/ask-user-question-session';

interface Option {
  label: string;
  description?: string;
  preview?: string;
}
interface Question {
  question: string;
  header: string;
  options: Option[];
  multiSelect?: boolean;
}
interface Args {
  questions: Question[];
}

type RawQuestion = Partial<Question> & {
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

export const AskUserQuestionToolUI = makeAssistantToolUI<Args, AskUserResult>({
  toolName: 'ask_user_question',
  display: 'standalone',
  render: ({ args, addResult, result, toolCallId, status }) => {
    const { t } = useTranslation();
    const rawQuestions = args?.questions ?? [];
    const questions = rawQuestions
      .map(normalizeQuestion)
      .filter((q): q is AskQuestion => q != null);

    const answered = hasAskUserAnswers(result);
    const awaiting = Boolean(addResult) && questions.length > 0 && !answered;

    useEffect(() => {
      if (!awaiting || !addResult) {
        setAskUserSession(null);
        return;
      }
      setAskUserSession({
        toolCallId,
        questions,
        addResult,
      });
      return () => setAskUserSession(null);
    }, [awaiting, addResult, toolCallId, JSON.stringify(questions)]);

    if (!answered && questions.length === 0) {
      const stillStreaming = status.type === 'running';
      return (
        <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
          <HelpCircleIcon className="size-3.5 shrink-0" />
          {stillStreaming ? t('ask.loading') : t('ask.invalidFormat')}
        </div>
      );
    }

    if (awaiting) {
      return (
        <div className="border-border/60 bg-muted/30 my-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <HelpCircleIcon className="text-primary size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-foreground font-medium">{t('ask.selectToContinue')}</p>
            {questions[0] && (
              <p className="text-foreground mt-1 leading-relaxed">{questions[0].question}</p>
            )}
          </div>
        </div>
      );
    }

    if (!answered && questions.length > 0 && !addResult) {
      return (
        <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
          <HelpCircleIcon className="size-3.5 shrink-0" />
          {t('ask.stopped')}
        </div>
      );
    }

    if (answered && result?.answers) {
      return (
        <div className="text-muted-foreground my-1 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <HelpCircleIcon className="size-3.5" />
            {t('ask.answered')}
          </div>
          <ul className="list-inside list-disc">
            {Object.entries(result.answers).map(([q, a]) => (
              <li key={q}>
                <span className="font-medium text-foreground">{q}</span> → {a}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return null;
  },
});
