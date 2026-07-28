import { useEffect, useRef, type FC, type ReactNode } from 'react';
import { parseCorrectionMessage, type CorrectionPayload } from '@/lib/correction-bridge';

/**
 * Widget→host action bridge (修正桥, scene-card v2 Phase 3). Wraps one
 * McpAppRenderer mount and listens for `window.parent.postMessage` from the
 * widget iframe INSIDE this wrapper — `event.source` must be the
 * `contentWindow` of an iframe in our own subtree (SafeContentFrame appends
 * the sandbox iframe directly into the renderer's container, no shadow DOM),
 * so a widget can never trigger another card's handler, and no page-level
 * singleton listener exists that a stray frame could reach.
 *
 * Only the `open-correction` action is bridged; validation/sanitization is
 * `parseCorrectionMessage` (size caps, control-char strip, silent drop of
 * everything else). What "open a correction" MEANS — which project or thread
 * receives the draft — is entirely the parent's `onCorrection`, built from
 * the parent's OWN context (its project prop / its current thread), never
 * from the message. Nothing is auto-sent.
 */
export const McpAppActionBridge: FC<{
  onCorrection: (payload: CorrectionPayload) => void;
  children: ReactNode;
}> = ({ onCorrection, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Live ref so the single listener never needs re-binding when the parent
  // re-creates its callback (same idiom as SandboxHost's liveRef).
  const onCorrectionRef = useRef(onCorrection);
  onCorrectionRef.current = onCorrection;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const root = containerRef.current;
      if (!root || !event.source) return;
      let own = false;
      for (const frame of root.querySelectorAll('iframe')) {
        if (frame.contentWindow === event.source) {
          own = true;
          break;
        }
      }
      if (!own) return;
      const payload = parseCorrectionMessage(event.data);
      if (!payload) return;
      onCorrectionRef.current(payload);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div ref={containerRef} className="contents">
      {children}
    </div>
  );
};
