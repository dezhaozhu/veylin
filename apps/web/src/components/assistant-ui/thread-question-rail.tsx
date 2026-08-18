import { useLayoutEffect, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { THREAD_QUESTION_RAIL_MIN_COUNT } from '@/lib/thread-question-nav';
import { useThreadQuestionRail } from '@/hooks/use-thread-question-rail';

const ROOT_SELECTOR = '.aui-thread-root';

type RailBox = {
  top: number;
  height: number;
  right: number;
};

function useFixedThreadRight(): RailBox | null {
  const [box, setBox] = useState<RailBox | null>(null);

  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
    if (!root) return;

    const sync = () => {
      const r = root.getBoundingClientRect();
      setBox({
        top: r.top,
        height: r.height,
        right: Math.max(4, Math.round(window.innerWidth - r.right + 8)),
      });
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  return box;
}

/**
 * ChatGPT minimap: a fixed column of thin ticks on the right.
 * Hover reveals the title list; click jumps to that turn.
 */
export const ThreadQuestionRail: FC = () => {
  const { t } = useTranslation();
  const { questions, activeId, scrollToQuestion } = useThreadQuestionRail();
  const box = useFixedThreadRight();
  const [open, setOpen] = useState(false);

  if (
    typeof document === 'undefined' ||
    !box ||
    questions.length < THREAD_QUESTION_RAIL_MIN_COUNT
  ) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-20"
      style={{ top: box.top, height: box.height, right: box.right }}
    >
      <div
        className="pointer-events-auto absolute top-1/2 right-0 -translate-y-1/2"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {open ? (
          <nav
            className="bg-muted/80 max-h-[min(70vh,28rem)] w-56 overflow-y-auto rounded-2xl px-2.5 py-2 shadow-sm backdrop-blur-sm"
            aria-label={t('thread.questionRailLabel')}
          >
            <ul className="flex flex-col gap-0.5">
              {questions.map((question) => {
                const active = question.id === activeId;
                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      title={question.label}
                      aria-current={active ? 'location' : undefined}
                      className={cn(
                        'w-full truncate rounded-lg px-2 py-1.5 text-left text-[12px] leading-5 transition-colors',
                        active
                          ? 'bg-foreground/8 text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                      )}
                      onClick={() => scrollToQuestion(question.id)}
                    >
                      {question.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : (
          <nav
            className="flex w-7 flex-col items-end gap-1"
            aria-label={t('thread.questionRailLabel')}
          >
            {questions.map((question) => {
              const active = question.id === activeId;
              return (
                <button
                  key={question.id}
                  type="button"
                  title={question.label}
                  aria-label={question.label}
                  aria-current={active ? 'location' : undefined}
                  className="flex h-[3px] w-full items-center justify-end"
                  onClick={() => scrollToQuestion(question.id)}
                >
                  <span
                    className={cn(
                      'block h-px rounded-full',
                      active ? 'bg-foreground/65 w-5' : 'bg-foreground/30 w-4',
                    )}
                  />
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>,
    document.body,
  );
};
