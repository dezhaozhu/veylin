import { useAui } from '@assistant-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';

type NavState = {
  entries: string[];
  index: number;
};

const EMPTY: NavState = { entries: [], index: -1 };

/** Browser-style back/forward history for thread switches. */
export function useThreadNavigationHistory(threadId: string | undefined) {
  const aui = useAui();
  const [nav, setNav] = useState<NavState>(EMPTY);
  const suppressRecordRef = useRef(false);

  useEffect(() => {
    if (!threadId) return;
    if (suppressRecordRef.current) {
      suppressRecordRef.current = false;
      return;
    }

    setNav((prev) => {
      if (prev.index >= 0 && prev.entries[prev.index] === threadId) return prev;
      const entries = [...prev.entries.slice(0, prev.index + 1), threadId];
      return { entries, index: entries.length - 1 };
    });
  }, [threadId]);

  const switchTo = useCallback(
    (index: number) => {
      const targetId = nav.entries[index];
      if (!targetId) return;
      suppressRecordRef.current = true;
      setNav((prev) => ({ ...prev, index }));
      void aui.threads().switchToThread(targetId);
    },
    [aui, nav.entries],
  );

  const goBack = useCallback(() => {
    if (nav.index <= 0) return;
    switchTo(nav.index - 1);
  }, [nav.index, switchTo]);

  const goForward = useCallback(() => {
    if (nav.index < 0 || nav.index >= nav.entries.length - 1) return;
    switchTo(nav.index + 1);
  }, [nav.entries.length, nav.index, switchTo]);

  return {
    canGoBack: nav.index > 0,
    canGoForward: nav.index >= 0 && nav.index < nav.entries.length - 1,
    goBack,
    goForward,
  };
}
