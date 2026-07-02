import { useCallback, useEffect, useRef, useState } from 'react';
import { Viewer, type OverlayJson } from '@caliper/viewer';
import type { FC } from 'react';
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
  const [state, setState] = useState<Viewer3dState | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [overlayData, setOverlayData] = useState<OverlayJson | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const overlayRequestRef = useRef(0);

  const resync = useCallback(async (resetSelection: boolean) => {
    try {
      const next = await fetchViewer3dState();
      setState(next);
      setSelection(resetSelection ? [] : (next.selection?.faceIds ?? []));
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

  // Contract §5: no model yet — keep Task 1's empty state.
  if (!state?.model) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        等待模型——让 agent 导入 STEP 模型后,此处将显示 3D 视图
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Task 5 接入点: useViewer3dSelectionSession() 的挂起请求提示条("{prompt} —— 选好后点确认" +
          确认/取消按钮)将插在这里,依赖尚未创建的前端 session 桥,本任务不实现(契约 §4)。 */}
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
