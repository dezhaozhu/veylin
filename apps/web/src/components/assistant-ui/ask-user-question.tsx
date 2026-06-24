import { makeAssistantToolUI } from '@assistant-ui/react';
import { CheckIcon, HelpCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

interface AskResult {
  questions: Question[];
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
}

const OTHER = '__other__';

function QuestionCard({
  q,
  value,
  other,
  focusedPreview,
  onPick,
  onOther,
  disabled,
}: {
  q: Question;
  value: string[];
  other: string;
  focusedPreview?: string;
  onPick: (label: string) => void;
  onOther: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="border-border/60 bg-muted/20 rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium">
          {q.header}
        </span>
        <span className="text-sm font-medium">{q.question}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {q.options.map((opt) => {
          const selected = value.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              disabled={disabled}
              onClick={() => onPick(opt.label)}
              className={cn(
                'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                selected ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-accent',
                disabled && 'opacity-60',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}
              >
                {selected && <CheckIcon className="size-3" />}
              </span>
              <span>
                <span className="font-medium">{opt.label}</span>
                {opt.description && (
                  <span className="text-muted-foreground block text-[11px]">{opt.description}</span>
                )}
              </span>
            </button>
          );
        })}
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
            value.includes(OTHER) ? 'border-primary bg-primary/5' : 'border-border/60',
          )}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(OTHER)}
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full border',
              value.includes(OTHER)
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border',
            )}
          >
            {value.includes(OTHER) && <CheckIcon className="size-3" />}
          </button>
          <input
            type="text"
            placeholder="Other…"
            value={other}
            disabled={disabled}
            onChange={(e) => onOther(e.target.value)}
            className="w-full bg-transparent outline-none"
          />
        </div>
      </div>
      {focusedPreview && (
        <details className="border-border/40 mt-2 rounded border p-2 text-[11px]">
          <summary className="text-muted-foreground cursor-pointer">Preview</summary>
          <pre className="mt-1 whitespace-pre-wrap">{focusedPreview}</pre>
        </details>
      )}
    </div>
  );
}

export const AskUserQuestionToolUI = makeAssistantToolUI<Args, AskResult>({
  toolName: 'ask_user_question',
  display: 'standalone',
  render: ({ args, addResult, status, result }) => {
    const { t } = useTranslation();
    const questions = args?.questions ?? [];
    const [picks, setPicks] = useState<Record<number, string[]>>({});
    const [others, setOthers] = useState<Record<number, string>>({});
    const done = status.type === 'complete';

    if (questions.length === 0) return null;

    const pick = (qi: number, label: string, multi: boolean) => {
      setPicks((prev) => {
        const cur = prev[qi] ?? [];
        if (multi) {
          return { ...prev, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
        }
        return { ...prev, [qi]: [label] };
      });
    };

    const submit = () => {
      if (!addResult) return;
      const answers: Record<string, string> = {};
      const annotations: Record<string, { preview?: string }> = {};
      questions.forEach((q, qi) => {
        const chosen = (picks[qi] ?? []).map((l) =>
          l === OTHER ? (others[qi] || 'Other').trim() : l,
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
      addResult({ questions, answers, annotations });
    };

    const canSubmit = questions.every((_, qi) => (picks[qi] ?? []).length > 0);

    return (
      <div className="my-2 flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <HelpCircleIcon className="size-3.5" />
          {done ? t('ask.answered') : t('ask.selectToContinue')}
        </div>
        {done && result?.answers ? (
          <ul className="text-muted-foreground list-inside list-disc text-xs">
            {Object.entries(result.answers).map(([q, a]) => (
              <li key={q}>
                <span className="font-medium text-foreground">{q}</span> → {a}
              </li>
            ))}
          </ul>
        ) : (
          <>
            {questions.map((q, qi) => {
              const selected = picks[qi] ?? [];
              const previewOpt = q.options.find((o) => selected.includes(o.label) && o.preview);
              return (
                <QuestionCard
                  key={qi}
                  q={q}
                  value={selected}
                  other={others[qi] ?? ''}
                  focusedPreview={previewOpt?.preview}
                  disabled={done}
                  onPick={(label) => pick(qi, label, q.multiSelect ?? false)}
                  onOther={(text) => setOthers((p) => ({ ...p, [qi]: text }))}
                />
              );
            })}
            {!done && (
              <div>
                <Button
                  size="sm"
                  className="h-7 rounded-full px-4 text-xs"
                  disabled={!canSubmit}
                  onClick={submit}
                >
                  {t('ask.submit')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    );
  },
});
