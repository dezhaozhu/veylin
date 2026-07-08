import { useAuiState } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectThreadQuestions,
  type ThreadQuestionItem,
} from '@/lib/thread-question-nav';

export type QuestionRailMarker = ThreadQuestionItem & {
  /** 0–1 position along the scroll track */
  ratio: number;
};

const VIEWPORT_SELECTOR = '[data-slot="aui_thread-viewport"]';
const MESSAGE_SELECTOR = '[data-question-id]';

function resolveScrollRatio(
  viewport: HTMLElement,
  element: HTMLElement,
): number {
  const maxScroll = Math.max(viewport.scrollHeight - viewport.clientHeight, 1);
  const viewportRect = viewport.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const offsetTop = elementRect.top - viewportRect.top + viewport.scrollTop;
  return Math.min(1, Math.max(0, offsetTop / maxScroll));
}

function markersEqual(
  prev: QuestionRailMarker[],
  next: QuestionRailMarker[],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (!a || !b) return false;
    if (
      a.id !== b.id ||
      a.label !== b.label ||
      Math.abs(a.ratio - b.ratio) > 0.001
    ) {
      return false;
    }
  }
  return true;
}

/** Stable string so selector output does not churn on every render. */
function buildQuestionSignature(
  messages: Parameters<typeof collectThreadQuestions>[0],
): string {
  return collectThreadQuestions(messages)
    .map((item) => `${item.id}\x1f${item.label}`)
    .join('\n');
}

function parseQuestionSignature(signature: string): ThreadQuestionItem[] {
  if (!signature) return [];
  return signature.split('\n').map((line) => {
    const splitIndex = line.indexOf('\x1f');
    if (splitIndex === -1) return { id: line, label: line };
    return {
      id: line.slice(0, splitIndex),
      label: line.slice(splitIndex + 1),
    };
  });
}

export function useThreadQuestionRail() {
  const questionSignature = useAuiState((s) =>
    buildQuestionSignature(s.thread.messages),
  );
  const questions = useMemo(
    () => parseQuestionSignature(questionSignature),
    [questionSignature],
  );
  const questionsRef = useRef(questions);
  questionsRef.current = questions;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<QuestionRailMarker[]>([]);

  const refreshMarkers = useCallback(() => {
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    const currentQuestions = questionsRef.current;
    if (!viewport || currentQuestions.length === 0) {
      setMarkers((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const next: QuestionRailMarker[] = [];
    for (const question of currentQuestions) {
      const element = viewport.querySelector<HTMLElement>(
        `${MESSAGE_SELECTOR}[data-question-id="${CSS.escape(question.id)}"]`,
      );
      if (!element) continue;
      next.push({
        ...question,
        ratio: resolveScrollRatio(viewport, element),
      });
    }
    setMarkers((prev) => (markersEqual(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    refreshMarkers();
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;

    const observer = new ResizeObserver(refreshMarkers);
    observer.observe(viewport);
    viewport.addEventListener('scroll', refreshMarkers, { passive: true });
    window.addEventListener('resize', refreshMarkers);

    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', refreshMarkers);
      window.removeEventListener('resize', refreshMarkers);
    };
  }, [questionSignature, refreshMarkers]);

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport || questions.length === 0) {
      setActiveId((prev) => (prev === null ? prev : null));
      return;
    }

    const elements = questions
      .map((question) =>
        viewport.querySelector<HTMLElement>(
          `${MESSAGE_SELECTOR}[data-question-id="${CSS.escape(question.id)}"]`,
        ),
      )
      .filter((element): element is HTMLElement => element != null);

    if (elements.length === 0) {
      setActiveId((prev) => (prev === null ? prev : null));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );
        const top = visible[0]?.target.getAttribute('data-question-id');
        if (top) setActiveId((prev) => (prev === top ? prev : top));
      },
      {
        root: viewport,
        rootMargin: '-20% 0px -65% 0px',
        threshold: 0,
      },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [questionSignature, questions]);

  const scrollToQuestion = useCallback((id: string) => {
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
    const element = viewport?.querySelector<HTMLElement>(
      `${MESSAGE_SELECTOR}[data-question-id="${CSS.escape(id)}"]`,
    );
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return {
    questions,
    markers,
    activeId: activeId ?? questions[0]?.id ?? null,
    scrollToQuestion,
  };
}
