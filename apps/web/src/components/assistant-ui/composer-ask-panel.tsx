import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getAskUserSession,
  subscribeAskUserSession,
  type AskQuestion,
  type AskUserResult,
} from '@/lib/ask-user-question-session';
import { waitForFrontendToolStop } from '@/lib/frontend-suspend-tools';

const OTHER = '__other__';

function optionBody(opt: { label: string; description?: string }): string {
  const description = opt.description?.trim();
  if (description) return description;
  return opt.label;
}

function buildResult(
  questions: AskQuestion[],
  picks: Record<number, string[]>,
  others: Record<number, string>,
): AskUserResult {
  const answers: Record<string, string> = {};
  const annotations: Record<string, { preview?: string }> = {};

  questions.forEach((q, qi) => {
    const chosen = (picks[qi] ?? []).map((label) =>
      label === OTHER ? (others[qi] || '').trim() || 'Other' : label,
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

function hasStepAnswer(selected: string[], other: string): boolean {
  if (selected.length === 0) return false;
  if (selected.includes(OTHER) && !other.trim()) return false;
  return true;
}

export function ComposerAskPanel() {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const session = useSyncExternalStore(subscribeAskUserSession, getAskUserSession, () => null);
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [others, setOthers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const questions = session?.questions ?? [];
  const total = questions.length;
  const current = questions[step];

  useEffect(() => {
    if (!session) {
      setStep(0);
      setPicks({});
      setOthers({});
      setCollapsed(false);
      setSubmitting(false);
      return;
    }
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [session?.toolCallId, session]);

  const pick = useCallback((qi: number, label: string, multi: boolean) => {
    setPicks((prev) => {
      const cur = prev[qi] ?? [];
      if (multi) {
        return {
          ...prev,
          [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
        };
      }
      return { ...prev, [qi]: [label] };
    });
  }, []);

  const submit = useCallback(
    async (result: AskUserResult) => {
      if (!session || submitting) return;
      setSubmitting(true);
      try {
        await waitForFrontendToolStop(session.toolCallId);
        session.addResult(result);
      } finally {
        setSubmitting(false);
      }
    },
    [session, submitting],
  );

  const skipAll = useCallback(() => {
    if (!session) return;
    const answers: Record<string, string> = {};
    for (const q of session.questions) answers[q.question] = '(skipped)';
    void submit({ questions: session.questions, answers });
  }, [session, submit]);

  const goNext = useCallback(() => {
    if (!session || total === 0) return;
    if (step < total - 1) {
      setStep((s) => s + 1);
      return;
    }
    void submit(buildResult(session.questions, picks, others));
  }, [session, step, total, picks, others, submit]);

  const goPrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  if (!session || total === 0 || !current) return null;

  const selected = picks[step] ?? [];
  const other = others[step] ?? '';
  const canNext = hasStepAnswer(selected, other);
  const isLast = step >= total - 1;
  const optionLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && canNext && !event.shiftKey) {
      event.preventDefault();
      goNext();
    }
  };

  return (
    <div
      ref={panelRef}
      className="border-border/70 bg-card/95 ring-primary/30 mb-2 w-full overflow-hidden rounded-2xl border shadow-[0_14px_40px_-28px_rgba(15,23,42,0.45)] ring-2"
      onKeyDown={onKeyDown}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-4',
          collapsed ? 'py-2.5' : 'pt-3 pb-1',
        )}
      >
        <span className="text-muted-foreground text-sm font-medium">{t('ask.panelTitle')}</span>
        <div className="text-muted-foreground flex items-center gap-1 text-sm">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            disabled={step === 0}
            onClick={goPrev}
            aria-label={t('ask.previous')}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="min-w-[4.5rem] text-center tabular-nums">
            {t('ask.stepOf', { current: step + 1, total })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            disabled={step >= total - 1}
            onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
            aria-label={t('ask.next')}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? t('ask.expand') : t('ask.collapse')}
          >
            <ChevronDownIcon className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="max-h-64 overflow-y-auto px-4 pt-3 pb-8">
            <div className="mb-4">
              <p className="text-foreground text-sm leading-relaxed font-medium">{current.question}</p>
            </div>
            <div className="flex flex-col gap-3">
              {current.options.map((opt, oi) => {
                const letter = optionLetters[oi] ?? String(oi + 1);
                const isSelected = selected.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => pick(step, opt.label, current.multiSelect ?? false)}
                    className={cn(
                      'group flex items-start gap-3 rounded-md text-left text-sm transition-colors',
                      isSelected
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'group-hover:bg-muted-foreground/15',
                      )}
                    >
                      {letter}
                    </span>
                    <span className="leading-relaxed">{optionBody(opt)}</span>
                  </button>
                );
              })}
              <div
                className={cn(
                  'group flex items-center gap-3 rounded-md text-sm transition-colors',
                  selected.includes(OTHER) ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => pick(step, OTHER, current.multiSelect ?? false)}
                  className={cn(
                    'bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded text-xs font-medium transition-colors',
                    selected.includes(OTHER)
                      ? 'bg-primary text-primary-foreground'
                      : 'group-hover:bg-muted-foreground/15',
                  )}
                >
                  {optionLetters[current.options.length] ?? '…'}
                </button>
                <input
                  type="text"
                  value={other}
                  placeholder={t('ask.otherPlaceholder')}
                  onChange={(e) => {
                    const text = e.target.value;
                    setOthers((p) => ({ ...p, [step]: text }));
                    if (text.trim()) {
                      setPicks((p) => ({ ...p, [step]: [OTHER] }));
                    }
                  }}
                  onFocus={() => pick(step, OTHER, current.multiSelect ?? false)}
                  className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-4 pb-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-sm"
              disabled={submitting}
              onClick={skipAll}
            >
              {t('ask.skip')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 rounded-lg bg-amber-600 px-3 text-sm text-white hover:bg-amber-700"
              disabled={!canNext || submitting}
              onClick={goNext}
            >
              {isLast ? t('ask.submit') : t('ask.next')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
