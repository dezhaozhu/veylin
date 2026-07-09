import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  clearAskUserSession,
  getAskUserSessionForThread,
  subscribeAskUserSession,
  type AskUserResult,
} from '@/lib/ask-user-question-session';
import { submitAskUserResult } from '@/lib/ask-user-submit-bridge';
import {
  allStepsAnswered,
  ASK_OTHER_OPTION,
  buildAskUserResult,
  hasStepAnswer,
} from '@/lib/composer-ask-panel-utils';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';

const OTHER = ASK_OTHER_OPTION;

function optionBody(opt: { label: string; description?: string }): string {
  const description = opt.description?.trim();
  if (description) return description;
  return opt.label;
}

export function ComposerAskPanel() {
  const { t } = useTranslation();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeToolCallIdRef = useRef<string | null>(null);
  const session = useSyncExternalStore(
    subscribeAskUserSession,
    () => getAskUserSessionForThread(threadId),
    () => null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [others, setOthers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const picksRef = useRef(picks);
  const othersRef = useRef(others);
  picksRef.current = picks;
  othersRef.current = others;

  const questions = session?.questions ?? [];
  const total = questions.length;
  const current = questions[step];

  useEffect(() => {
    if (!session) {
      activeToolCallIdRef.current = null;
      return;
    }
    if (isTauri()) void hideWebView(undefined, { force: true });
    if (activeToolCallIdRef.current !== session.toolCallId) {
      activeToolCallIdRef.current = session.toolCallId;
      setStep(0);
      setPicks({});
      setOthers({});
      setCollapsed(false);
      setSubmitting(false);
      setSubmitError(null);
    }
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [session?.toolCallId]);

  const deliverResult = useCallback(
    (result: AskUserResult): void => {
      if (submitting) return;
      const active = getAskUserSessionForThread(threadId);
      if (!active) {
        setSubmitError(t('ask.submitFailed'));
        return;
      }

      const { toolCallId, addResult } = active;
      setSubmitting(true);
      setSubmitError(null);

      void (async () => {
        try {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          let delivered = false;
          try {
            delivered = await submitAskUserResult(threadId, toolCallId, result);
          } catch (err) {
            console.warn('[ask] submitter failed, using session fallback', err);
          }
          if (!delivered) addResult(result);
          clearAskUserSession(threadId, toolCallId);
        } catch (err) {
          console.error('[ask] submit failed', err);
          setSubmitError(t('ask.submitFailed'));
        } finally {
          setSubmitting(false);
        }
      })();
    },
    [submitting, threadId, t],
  );

  const skipAll = useCallback(() => {
    const active = getAskUserSessionForThread(threadId);
    if (!active) return;
    const answers: Record<string, string> = {};
    for (const q of active.questions) answers[q.question] = '(skipped)';
    void deliverResult({ questions: active.questions, answers });
  }, [deliverResult, threadId]);

  const goNext = useCallback(() => {
    const active = getAskUserSessionForThread(threadId);
    if (!active || active.questions.length === 0) {
      setSubmitError(t('ask.submitFailed'));
      return;
    }
    const currentPicks = picksRef.current;
    const currentOthers = othersRef.current;
    const count = active.questions.length;
    if (step < count - 1) {
      if (!hasStepAnswer(currentPicks[step] ?? [], currentOthers[step] ?? '')) return;
      setStep((s) => s + 1);
      return;
    }
    if (!allStepsAnswered(active.questions, currentPicks, currentOthers)) {
      setSubmitError(t('ask.answerAllFirst'));
      return;
    }
    deliverResult(buildAskUserResult(active.questions, currentPicks, currentOthers));
  }, [step, deliverResult, threadId, t]);

  const goPrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const pick = useCallback(
    (qi: number, label: string, multi: boolean) => {
      setPicks((prev) => {
        const cur = prev[qi] ?? [];
        const next = multi
          ? {
              ...prev,
              [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
            }
          : { ...prev, [qi]: [label] };
        picksRef.current = next;
        return next;
      });
      if (label !== OTHER) {
        setOthers((prev) => {
          if (!prev[qi]) return prev;
          const next = { ...prev };
          delete next[qi];
          othersRef.current = next;
          return next;
        });
      }
    },
    [],
  );

  if (!session || total === 0 || !current) return null;

  const selected = picks[step] ?? [];
  const other = others[step] ?? '';
  const stepReady = hasStepAnswer(selected, other);
  const isLast = step >= total - 1;
  const canSubmit = isLast
    ? allStepsAnswered(questions, picks, others)
    : stepReady;
  const optionLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && canSubmit && !event.shiftKey) {
      event.preventDefault();
      goNext();
    }
  };

  const onOptionPointerDown = (
    event: PointerEvent,
    qi: number,
    label: string,
    multi: boolean,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pick(qi, label, multi);
  };

  return (
    <div
      ref={panelRef}
      className="border-border/70 bg-card/95 ring-primary/30 pointer-events-auto relative z-[200] mb-2 w-full touch-manipulation overflow-visible rounded-2xl border shadow-[0_14px_40px_-28px_rgba(15,23,42,0.45)] ring-2"
      onKeyDown={onKeyDown}
      onPointerDownCapture={() => {
        if (isTauri()) void hideWebView(undefined, { force: true });
      }}
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
            disabled={step >= total - 1 || !stepReady}
            onClick={() => {
              if (!stepReady || step >= total - 1) return;
              setStep((s) => Math.min(total - 1, s + 1));
            }}
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
                    key={`${step}-${oi}-${opt.label}`}
                    type="button"
                    onPointerDown={(event) =>
                      onOptionPointerDown(event, step, opt.label, current.multiSelect ?? false)
                    }
                    className={cn(
                      'group flex cursor-pointer items-start gap-3 rounded-md text-left text-sm transition-colors',
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
                  onPointerDown={(event) =>
                    onOptionPointerDown(event, step, OTHER, current.multiSelect ?? false)
                  }
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
                    setOthers((p) => {
                      const next = { ...p, [step]: text };
                      othersRef.current = next;
                      return next;
                    });
                    if (text.trim()) {
                      setPicks((p) => {
                        const next = { ...p, [step]: [OTHER] };
                        picksRef.current = next;
                        return next;
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit && isLast) {
                      e.preventDefault();
                      goNext();
                    }
                  }}
                  className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
                />
              </div>
            </div>
          </div>
          <div className="relative z-[210] flex flex-col items-end gap-1 px-4 pb-3">
            {submitError && (
              <p className="text-destructive text-xs">{submitError}</p>
            )}
            {isLast && !canSubmit && !submitError && (
              <p className="text-muted-foreground text-xs">{t('ask.answerAllFirst')}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-sm"
                disabled={submitting}
                onPointerDown={(event) => {
                  if (event.button !== 0 || submitting) return;
                  event.preventDefault();
                  skipAll();
                }}
              >
                {t('ask.skip')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                className={cn(
                  'h-8 gap-1.5 rounded-lg px-3 text-sm',
                  canSubmit && !submitting && 'bg-amber-600 text-white hover:bg-amber-700',
                )}
                disabled={!canSubmit || submitting}
                title={!canSubmit ? t('ask.answerAllFirst') : undefined}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !canSubmit || submitting) return;
                  event.preventDefault();
                  goNext();
                }}
              >
                {isLast ? t('ask.submit') : t('ask.next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
