import { makeAssistantToolUI, useAuiState } from '@assistant-ui/react';
import { HelpCircleIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeAskQuestions } from '@/lib/ask-user-question-normalize';
import {
  hasAskUserAnswers,
  clearAskUserSession,
  getAskUserSessionForThread,
  setAskUserSession,
  type AskUserResult,
} from '@/lib/ask-user-question-session';

interface Question {
  question: string;
  header: string;
  options: { label: string; description?: string; preview?: string }[];
  multiSelect?: boolean;
}
interface Args {
  questions: Question[];
}

export const AskUserQuestionToolUI = makeAssistantToolUI<Args, AskUserResult>({
  toolName: 'ask_user_question',
  display: 'standalone',
  render: ({ args, addResult, result, toolCallId, status }) => {
    const { t } = useTranslation();
    const threadId = useAuiState((s) => s.threadListItem.id);
    const questions = normalizeAskQuestions(args?.questions ?? []);

    const answered = hasAskUserAnswers(result);
    const awaiting = Boolean(addResult) && questions.length > 0 && !answered;
    const addResultRef = useRef(addResult);
    addResultRef.current = addResult;

    const questionsKey = JSON.stringify(
      questions.map((q) => ({
        question: q.question,
        options: q.options.map((o) => o.label),
      })),
    );

    useEffect(() => {
      if (answered) {
        clearAskUserSession(threadId, toolCallId);
        return;
      }
      if (!awaiting || !addResult) return;
      setAskUserSession({
        threadId,
        toolCallId,
        questions,
        addResult: (payload) => {
          const fn = addResultRef.current;
          if (!fn) {
            throw new Error('ask_user_question addResult unavailable');
          }
          fn(payload);
        },
      });
    }, [awaiting, addResult, threadId, toolCallId, questionsKey]);

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
      const restored =
        getAskUserSessionForThread(threadId)?.toolCallId === toolCallId;
      return (
        <div className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs">
          <HelpCircleIcon className="size-3.5 shrink-0" />
          {restored ? t('ask.selectToContinue') : t('ask.stopped')}
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
