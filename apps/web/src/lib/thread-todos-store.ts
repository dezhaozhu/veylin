/** Fetch and cache thread todos for composer status / restore on switch. */

import { isPersistableThreadId } from './sync-thread-messages';

export type ThreadTodoItem = {
  id: string;
  content: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
};

type Snapshot = {
  threadId: string | undefined;
  todos: ThreadTodoItem[];
};

let snapshot: Snapshot = { threadId: undefined, todos: [] };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getThreadTodosSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeThreadTodos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThreadTodosSnapshot(threadId: string | undefined, todos: ThreadTodoItem[]): void {
  snapshot = { threadId, todos };
  emit();
}

export function clearThreadTodosSnapshot(): void {
  snapshot = { threadId: undefined, todos: [] };
  emit();
}

export async function fetchThreadTodos(threadId: string): Promise<ThreadTodoItem[]> {
  if (!isPersistableThreadId(threadId)) return [];
  const res = await fetch(`/api/todos?threadId=${encodeURIComponent(threadId)}`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { todos?: ThreadTodoItem[] };
  const todos = data.todos ?? [];
  setThreadTodosSnapshot(threadId, todos);
  return todos;
}
