import { makeAssistantToolUI } from '@assistant-ui/react';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

interface TodoResult {
  oldTodos?: TodoItem[];
  newTodos?: TodoItem[];
}

/**
 * todo_write has no inline footprint: the live todo list is surfaced in a single
 * always-refreshing place (the composer status bar that polls /api/todos), so we
 * register it as a standalone tool UI that renders nothing. Keeping the standalone
 * registration is what excludes todo_write from the generic ToolFallback grouping;
 * dropping it entirely would re-surface "Used tool: todo_write" entries.
 */
export const TodoWriteToolUI = makeAssistantToolUI<{ todos: TodoItem[] }, TodoResult>({
  toolName: 'todo_write',
  display: 'standalone',
  render: () => null,
});
