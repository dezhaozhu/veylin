/** In-process live progress for running subagent tasks (not persisted). */

export type TaskProgress = {
  toolUseCount: number;
  totalTokens: number | null;
  lastToolName: string | null;
  /** Compact JSON/string preview of the last tool's args. */
  lastToolArgs: string | null;
  currentActivity: string | null;
  updatedAt: number;
};

const progressByTaskId = new Map<string, TaskProgress>();

export function getTaskProgress(taskId: string): TaskProgress | null {
  return progressByTaskId.get(taskId) ?? null;
}

export function setTaskProgress(
  taskId: string,
  patch: Partial<Omit<TaskProgress, 'updatedAt'>> & {
    toolUseCount?: number;
  },
): TaskProgress {
  const prev = progressByTaskId.get(taskId);
  const next: TaskProgress = {
    toolUseCount: patch.toolUseCount ?? prev?.toolUseCount ?? 0,
    totalTokens: patch.totalTokens !== undefined ? patch.totalTokens : (prev?.totalTokens ?? null),
    lastToolName:
      patch.lastToolName !== undefined ? patch.lastToolName : (prev?.lastToolName ?? null),
    lastToolArgs:
      patch.lastToolArgs !== undefined ? patch.lastToolArgs : (prev?.lastToolArgs ?? null),
    currentActivity:
      patch.currentActivity !== undefined
        ? patch.currentActivity
        : (prev?.currentActivity ?? null),
    updatedAt: Date.now(),
  };
  progressByTaskId.set(taskId, next);
  return next;
}

export function clearTaskProgress(taskId: string): void {
  progressByTaskId.delete(taskId);
}

export function formatTaskActivity(progress: TaskProgress): string {
  if (progress.currentActivity?.trim()) return progress.currentActivity.trim();
  if (progress.lastToolName) {
    return progress.lastToolArgs
      ? `${progress.lastToolName} ${progress.lastToolArgs}`
      : progress.lastToolName;
  }
  if (progress.toolUseCount > 0) {
    return `${progress.toolUseCount} tool uses`;
  }
  return 'Initializing…';
}
