export type TaskEventKind =
  | 'task.snapshot'
  | 'task.updated'
  | 'batch.readiness';

export type TaskEvent = {
  kind: TaskEventKind;
  threadId: string;
  taskId?: string;
};

type TaskEventListener = (event: TaskEvent) => void;

const listenersByThread = new Map<string, Set<TaskEventListener>>();

export function subscribeTaskEvents(
  threadId: string,
  listener: TaskEventListener,
): () => void {
  let listeners = listenersByThread.get(threadId);
  if (!listeners) {
    listeners = new Set();
    listenersByThread.set(threadId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) listenersByThread.delete(threadId);
  };
}

export function publishTaskEvent(event: TaskEvent): void {
  const listeners = listenersByThread.get(event.threadId);
  if (!listeners?.size) return;
  for (const listener of listeners) listener(event);
}

