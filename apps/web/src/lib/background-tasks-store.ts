import type { BackgroundTaskRow } from './background-task-continuation';

export type BackgroundTasksSnapshot = {
  /** Thread this snapshot belongs to. Consumers must ignore mismatched threads to avoid cross-session leakage. */
  threadId: string | null;
  tasks: BackgroundTaskRow[];
  batchTasks: BackgroundTaskRow[];
  /** Last known dispatch batch ids — keeps completed workers visible until synthesis. */
  dispatchTaskIds: string[];
  /**
   * Task ids cancelled by Stop. Status bar must treat these as interrupted even when
   * transcript optimistic rows still say running/queued (id mismatch races).
   */
  interruptedTaskIds: string[];
  notificationsReady: boolean;
  synthesisReady: boolean;
};

const EMPTY: BackgroundTasksSnapshot = {
  threadId: null,
  tasks: [],
  batchTasks: [],
  dispatchTaskIds: [],
  interruptedTaskIds: [],
  notificationsReady: false,
  synthesisReady: false,
};

let snapshot: BackgroundTasksSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getBackgroundTasksSnapshot(): BackgroundTasksSnapshot {
  return snapshot;
}

export function setBackgroundTasksSnapshot(next: BackgroundTasksSnapshot): void {
  snapshot = {
    ...next,
    interruptedTaskIds: next.interruptedTaskIds ?? [],
  };
  for (const listener of listeners) listener();
}

export function subscribeBackgroundTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetBackgroundTasksSnapshot(): void {
  setBackgroundTasksSnapshot(EMPTY);
}
