import { useCallback, useEffect, useRef, useState } from 'react';
import { Viewer, type OverlayJson } from '@caliper/viewer';
import { Layers3Icon } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useViewer3dSelectionRequest } from '@/lib/viewer3d-selection-session';
import type { PanelContentProps } from '../panel-types';

interface Viewer3dModel {
  meshUrl: string;
  title?: string;
  modelId?: string;
}

interface Viewer3dSelection {
  faceIds: number[];
  updatedAt: string;
}

interface Viewer3dState {
  model: Viewer3dModel | null;
  overlayUrl: string | null;
  selection: Viewer3dSelection | null;
}

/** Mirrors apps/server/src/viewer3d-store.ts's Viewer3dEvent (SSE payload shape). */
type Viewer3dEvent =
  | { type: 'modelReplace' }
  | { type: 'overlayUpdate' }
  | { type: 'selectionChange' };

async function fetchViewer3dState(): Promise<Viewer3dState> {
  const res = await fetch('/api/viewer3d');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as Viewer3dState;
}

/** Best-effort: the panel's local selection is the source of truth (see contract §2), so a
 * failed POST does not roll back the UI — it just means the context block lags until the
 * next successful selection change. */
async function postSelection(faceIds: number[]): Promise<void> {
  try {
    await fetch('/api/viewer3d/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faceIds }),
    });
  } catch {
    // ignore — best-effort mirror to the store
  }
}

export const Viewer3dPanel: FC<PanelContentProps> = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<Viewer3dState | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [overlayData, setOverlayData] = useState<OverlayJson | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const overlayRequestRef = useRef(0);
  const selectionRequest = useViewer3dSelectionRequest();
  // Double-submit guard, mirrors composer-ask-panel.tsx's `submitting` pattern: a second
  // click while addResult is being delivered must not call confirm/cancel again.
  const [submitting, setSubmitting] = useState(false);

  // Reset the guard whenever the pending request changes: a new request arrives
  // (different toolCallId) or the current one is cleared (undefined).
  useEffect(() => {
    setSubmitting(false);
  }, [selectionRequest?.toolCallId]);

  const confirmSelectionRequest = useCallback(() => {
    // Empty selection must go through cancel, never confirm: the agent cannot act on
    // an empty face_ids array (the Confirm button is also disabled in that state).
    if (!selectionRequest || submitting || selection.length === 0) return;
    setSubmitting(true);
    selectionRequest.confirm(selection);
  }, [selectionRequest, submitting, selection]);

  const cancelSelectionRequest = useCallback(() => {
    if (!selectionRequest || submitting) return;
    setSubmitting(true);
    selectionRequest.cancel();
  }, [selectionRequest, submitting]);

  const resync = useCallback(async (resetSelection: boolean) => {
    try {
      const next = await fetchViewer3dState();
      setState(next);
      setSelection((prev) => {
        if (resetSelection) return []; // modelReplace: stale faceIds must not survive
        // Initialize-only restore: the panel unmounts when the right sidebar collapses,
        // losing local selection state — on remount, seed it from the server mirror.
        // Once the user has picked locally, local stays authoritative (contract §2/§3):
        // a mid-session resync (SSE reconnect, overlayUpdate) must not clobber it.
        if (prev.length > 0) return prev;
        return next.selection?.faceIds ?? [];
      });
    } catch {
      // keep last known state; the next SSE reconnect (onopen) retries the resync
    }
  }, []);

  // Contract §1: initial resync + SSE subscription, mirrors table-grid.tsx:611-648
  // (onopen → full resync, onmessage → dispatch by type, unmount → close).
  useEffect(() => {
    void resync(false);
    const es = new EventSource('/api/viewer3d/stream');
    es.onopen = () => {
      void resync(false); // (re)connected — one full resync catches anything missed
    };
    es.onmessage = (ev) => {
      let e: Viewer3dEvent;
      try {
        e = JSON.parse(ev.data) as Viewer3dEvent;
      } catch {
        return;
      }
      if (e.type === 'modelReplace') {
        void resync(true); // stale faceIds from the previous model must not survive
      } else if (e.type === 'overlayUpdate') {
        void resync(false);
      }
      // selectionChange: first cut keeps the local selection authoritative — the remote
      // event only matters for multi-window sync, out of scope for this pass (contract §2).
    };
    return () => es.close();
  }, [resync]);

  // Contract §2: overlayUrl is an absolute URL into the caliper server (CORS already
  // allowed) — fetch it directly whenever it changes; Viewer itself re-validates structure,
  // this only guards the fetch/parse step and surfaces a Chinese error banner on failure.
  useEffect(() => {
    const overlayUrl = state?.overlayUrl ?? null;
    if (!overlayUrl) {
      setOverlayData(null);
      setOverlayError(null);
      return;
    }
    const requestId = ++overlayRequestRef.current;
    setOverlayError(null);
    (async () => {
      try {
        const res = await fetch(overlayUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OverlayJson;
        if (overlayRequestRef.current !== requestId) return; // superseded by a newer overlayUrl
        setOverlayData(json);
      } catch (err) {
        if (overlayRequestRef.current !== requestId) return;
        setOverlayData(null);
        setOverlayError(`云图加载失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [state?.overlayUrl]);

  // Contract §3: mirrors table-grid.tsx:235-247's patchRow — local state updates immediately,
  // the POST is a best-effort mirror to the store (context block data source).
  const handleSelectionChange = useCallback((faceIds: number[]) => {
    setSelection(faceIds);
    void postSelection(faceIds);
  }, []);

  const hasModel = Boolean(state?.model);

  // Rendered independently of the no-model empty state: an out-of-order
  // request_3d_selection (before any viewer3d_show_model) must still surface the
  // prompt bar — as a cancel-only variant — instead of deadlocking the tool call.
  // Once a model arrives (modelReplace → resync), the bar upgrades in place.
  const promptBar = selectionRequest ? (
    <div className="border-primary/30 bg-primary/5 mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
      <div className="flex min-w-0 items-start gap-2">
        <Layers3Icon className="text-primary mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-foreground font-medium">{selectionRequest.prompt}</p>
          <p className="text-muted-foreground mt-0.5">
            {hasModel ? t('viewer3d.promptHint') : t('viewer3d.promptNoModel')}
          </p>
          {hasModel && selection.length === 0 ? (
            <p className="text-muted-foreground mt-0.5">{t('viewer3d.promptPickFirst')}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={submitting}
          onClick={cancelSelectionRequest}
        >
          {t('viewer3d.promptCancel')}
        </Button>
        {hasModel ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-7 px-3 text-xs"
            disabled={submitting || selection.length === 0}
            title={selection.length === 0 ? t('viewer3d.promptPickFirst') : undefined}
            onClick={confirmSelectionRequest}
          >
            {t('viewer3d.promptConfirm')}
          </Button>
        ) : null}
      </div>
    </div>
  ) : null;

  // Contract §5: no model yet — keep Task 1's empty state (plus the prompt bar above it).
  if (!state?.model) {
    return (
      <div className="flex h-full flex-col">
        {promptBar}
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          等待模型——让 agent 导入 STEP 模型后,此处将显示 3D 视图
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {promptBar}
      {overlayError ? (
        <div className="border-destructive/20 bg-destructive/10 text-destructive mx-3 mt-3 rounded-lg border px-3 py-2 text-xs">
          {overlayError}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <Viewer
          meshUrl={state.model.meshUrl}
          overlay={overlayData}
          selection={selection}
          onSelectionChange={handleSelectionChange}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};
