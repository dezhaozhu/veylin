/** Per-thread history load error for Thread UI (retry instead of Welcome blank). */

type HistoryLoadState = {
  remoteId: string | null;
  error: string | null;
};

let state: HistoryLoadState = { remoteId: null, error: null };
const listeners = new Set<() => void>();
let retryHandler: (() => void) | null = null;

function emit() {
  for (const l of listeners) l();
}

export function setHistoryLoadError(remoteId: string | null, error: string | null): void {
  if (state.remoteId === remoteId && state.error === error) return;
  state = { remoteId, error };
  emit();
}

export function clearHistoryLoadError(remoteId?: string | null): void {
  if (remoteId != null && state.remoteId != null && state.remoteId !== remoteId) return;
  if (state.error == null && state.remoteId == null) return;
  state = { remoteId: null, error: null };
  emit();
}

export function setHistoryLoadRetry(handler: (() => void) | null): void {
  retryHandler = handler;
}

export function retryHistoryLoad(): void {
  retryHandler?.();
}

export function getHistoryLoadState(): HistoryLoadState {
  return state;
}

export function subscribeHistoryLoadState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
