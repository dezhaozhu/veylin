import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';

/** Auto open while streaming, auto collapse when done; manual toggle sticks. */
export function useStreamingCollapsible(
  streaming: boolean | undefined,
  controlledOpen?: boolean,
  controlledOnOpenChange?: (open: boolean) => void,
  defaultOpen = false,
) {
  const initialOpenRef = useRef(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled
    ? controlledOpen
    : (userOpen ?? (streaming ? true : initialOpenRef.current));

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!isControlled) setUserOpen(open);
      controlledOnOpenChange?.(open);
    },
    [isControlled, controlledOnOpenChange],
  );

  return { isOpen, handleOpenChange };
}

export function useStreamingDuration(active: boolean): number | undefined {
  const startRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | undefined>();

  useLayoutEffect(() => {
    if (active) {
      if (startRef.current == null) startRef.current = Date.now();
      const tick = () => {
        if (startRef.current == null) return;
        setSeconds(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
      };
      tick();
      const id = window.setInterval(tick, 250);
      return () => window.clearInterval(id);
    }

    if (startRef.current != null) {
      setSeconds(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
      startRef.current = null;
    }
    return undefined;
  }, [active]);

  return seconds;
}

/** Group is live when the message cursor is on one of its parts. */
export function useGroupStreaming(indices: readonly number[]): boolean {
  return useAuiState((s) => {
    if (s.message.status?.type !== 'running') return false;
    const lastIdx = s.message.parts.length - 1;
    if (lastIdx < 0 || !indices.includes(lastIdx)) return false;
    return s.message.parts[lastIdx]?.status?.type === 'running';
  });
}
