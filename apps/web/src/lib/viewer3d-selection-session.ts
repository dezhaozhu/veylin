import { useSyncExternalStore } from 'react';

/**
 * Pending request_3d_selection tool call, bridged from the tool UI (which owns
 * `addResult`) to the '3d' right-panel (which owns the local face selection and
 * renders the confirm/cancel prompt bar). Mirrors the ask-user-question session
 * bridge (apps/web/src/lib/ask-user-question-session.ts): a module-level store
 * with a listener set, read via useSyncExternalStore.
 *
 * Unlike ask-user-question's session (keyed by threadId, since it must survive
 * a composer re-render across the whole chat), this is a single global slot:
 * only one 3D panel exists and the suspended tool call blocks the agent run, so
 * at most one request is ever pending at a time.
 */
export interface Viewer3dSelectionRequest {
  toolCallId: string;
  prompt: string;
  /** Deliver the user's picked faces — internally calls addResult({ face_ids }). */
  confirm: (faceIds: number[]) => void;
  /** User declined to pick — internally calls addResult({ face_ids: [], cancelled: true }). */
  cancel: () => void;
}

let current: Viewer3dSelectionRequest | null = null;
const listeners = new Set<() => void>();

export function setViewer3dSelectionRequest(next: Viewer3dSelectionRequest | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getViewer3dSelectionRequest(): Viewer3dSelectionRequest | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewer3dSelectionRequest(): Viewer3dSelectionRequest | null {
  return useSyncExternalStore(subscribe, getViewer3dSelectionRequest, () => null);
}
