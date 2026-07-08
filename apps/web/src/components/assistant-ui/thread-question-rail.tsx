import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  THREAD_QUESTION_RAIL_MIN_COUNT,
} from '@/lib/thread-question-nav';
import { useThreadQuestionRail } from '@/hooks/use-thread-question-rail';

export const ThreadQuestionRail: FC = () => {
  const { t } = useTranslation();
  const { questions, markers, activeId, scrollToQuestion } = useThreadQuestionRail();
  const [expanded, setExpanded] = useState(false);

  if (questions.length < THREAD_QUESTION_RAIL_MIN_COUNT) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-20 hidden @min-[56rem]:block"
      aria-hidden={!expanded}
    >
      <div
        className={cn(
          'pointer-events-auto sticky top-1/2 flex -translate-y-1/2 flex-col items-end',
          expanded ? 'w-[220px]' : 'w-5',
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {expanded ? (
          <div
            className="bg-popover text-popover-foreground mr-2 max-h-[min(70vh,28rem)] w-full overflow-y-auto rounded-xl border p-2 shadow-md"
            role="navigation"
            aria-label={t('thread.questionRailLabel')}
          >
            <ul className="flex flex-col gap-0.5">
              {questions.map((question) => {
                const active = question.id === activeId;
                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      className={cn(
                        'hover:bg-accent w-full rounded-lg px-2.5 py-2 text-left text-sm leading-snug transition-colors',
                        active && 'bg-accent font-medium',
                      )}
                      onClick={() => scrollToQuestion(question.id)}
                    >
                      {question.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div
            className="relative mr-1 h-[min(70vh,20rem)] w-5"
            role="navigation"
            aria-label={t('thread.questionRailLabel')}
          >
            {markers.map((marker) => {
              const active = marker.id === activeId;
              return (
                <button
                  key={marker.id}
                  type="button"
                  title={marker.label}
                  aria-label={marker.label}
                  className="absolute right-0 flex h-4 w-full items-center justify-end"
                  style={{ top: `${marker.ratio * 100}%`, transform: 'translateY(-50%)' }}
                  onClick={() => scrollToQuestion(marker.id)}
                >
                  <span
                    className={cn(
                      'bg-border block h-px rounded-full transition-all',
                      active ? 'bg-foreground/70 w-3.5' : 'w-2 opacity-70',
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
