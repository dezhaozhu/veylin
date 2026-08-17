import { useEffect, useRef, type FC, type ReactNode } from 'react';
import {
  parseCorrectionMessage,
  parseOpenGridMessage,
  type CorrectionPayload,
  type OpenGridFilter,
} from '@/lib/correction-bridge';

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
 *
 * USER-GESTURE GATE (security review V1): the message alone is not authority.
 * A widget script could post without anyone clicking, and the project-page
 * handler creates + pins a real thread and navigates away — so a card from
 * ANY connected MCP server could hijack the page on every visit and litter
 * the workspace with threads. We therefore require transient user activation
 * (which propagates from a click inside the iframe to this ancestor) before
 * acting. Scripted posts are dropped; a real click always carries it.
 */
/**
 * Transient user activation, i.e. "did a real gesture just happen". Chrome and
 * WebKit both ship `navigator.userActivation`; where it is missing we fail
 * OPEN (the bridge keeps working) rather than breaking the feature on older
 * engines — the containment + sanitization guarantees still hold there.
 */
function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : true;
}

export const McpAppActionBridge: FC<{
  onCorrection: (payload: CorrectionPayload) => void;
  /** Optional: widget "展开排产表" drill (open-schedule-grid). Same containment
   * + user-gesture gate as onCorrection; the filter only narrows the current
   * thread's grid. Omit (e.g. contexts with no schedule grid) → drill no-ops. */
  onOpenGrid?: (filter: OpenGridFilter) => void;
  children: ReactNode;
}> = ({ onCorrection, onOpenGrid, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Live ref so the single listener never needs re-binding when the parent
  // re-creates its callback (same idiom as SandboxHost's liveRef).
  const onCorrectionRef = useRef(onCorrection);
  onCorrectionRef.current = onCorrection;
  const onOpenGridRef = useRef(onOpenGrid);
  onOpenGridRef.current = onOpenGrid;

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
      if (!hasUserActivation()) return;
      const correction = parseCorrectionMessage(event.data);
      if (correction) {
        onCorrectionRef.current(correction);
        return;
      }
      const gridFilter = parseOpenGridMessage(event.data);
      if (gridFilter && onOpenGridRef.current) {
        onOpenGridRef.current(gridFilter);
      }
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
