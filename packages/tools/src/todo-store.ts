export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
};

const store = new Map<string, TodoItem[]>();

export function getTodos(threadId: string): TodoItem[] {
  return store.get(threadId) ?? [];
}

export function setTodos(threadId: string, todos: TodoItem[]): TodoItem[] {
  // Keep the full list (including an all-completed state); the next task sends a
  // fresh full list which naturally replaces it.
  store.set(threadId, todos);
  return todos;
}

export function updateTodos(threadId: string, todos: TodoItem[]): { oldTodos: TodoItem[]; newTodos: TodoItem[] } {
  const oldTodos = getTodos(threadId);
  const newTodos = setTodos(threadId, todos);
  return { oldTodos, newTodos };
}
