import { makeAssistantToolUI } from '@assistant-ui/react';

export const TaskCreateToolUI = makeAssistantToolUI<
  { prompt: string; agentId?: string; label?: string },
  { taskId: string; jobId: string | null }
>({
  toolName: 'task_create',
  render: ({ result }) => {
    if (!result?.taskId) return null;
    return (
      <div className="text-muted-foreground my-1 text-xs">
        Background task started: <span className="font-mono">{result.taskId.slice(0, 8)}…</span>
      </div>
    );
  },
});
