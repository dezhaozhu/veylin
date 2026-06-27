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

function normalizeQuestion(raw: Partial<Question> | undefined): AskQuestion | null {
  if (!raw?.question?.trim() || !raw?.header?.trim()) return null;
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is Option => Boolean(o?.label?.trim()))
    : [];
  if (options.length === 0) return null;
  return {
    question: raw.question.trim(),
    header: raw.header.trim(),
    options,
    multiSelect: raw.multiSelect ?? false,
  };
}

export const AskUserQuestionToolUI = makeAssistantToolUI<Args, AskUserResult>({
  toolName: 'ask_user_question',
  display: 'standalone',
  render: ({ args, addResult, result, toolCallId }) => {
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

    if (rawQuestions.length > 0 && !answered && questions.length === 0) {
      return (
        <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
          <HelpCircleIcon className="size-3.5" />
          {t('ask.loading')}
        </div>
      );
    }

    if (awaiting) return null;

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
