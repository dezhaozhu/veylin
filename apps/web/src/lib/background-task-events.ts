import type { BackgroundTaskRow } from './background-task-continuation';

export type BackgroundTasksApiSnapshot = {
  tasks?: BackgroundTaskRow[];
  batch?: {
    taskIds?: string[];
    notificationsReady?: boolean;
    synthesisReady?: boolean;
    terminalCount?: number;
    totalCount?: number;
  };
  error?: string;
};

export async function fetchBackgroundTaskSnapshot(
  threadId: string,
  batchIds: string[] = [],
): Promise<BackgroundTasksApiSnapshot | null> {
  const query = new URLSearchParams({ threadId });
  if (batchIds.length > 0) query.set('batchIds', batchIds.join(','));
  const res = await fetch(`/api/tasks?${query.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) return null;
  return (await res.json()) as BackgroundTasksApiSnapshot;
}

export function subscribeBackgroundTaskEvents(
  threadId: string,
  onEvent: (snapshot: BackgroundTasksApiSnapshot | null) => void,
  onError?: () => void,
): () => void {
  if (typeof EventSource === 'undefined') {
    onError?.();
    return () => undefined;
  }

  const query = new URLSearchParams({ threadId });
  const source = new EventSource(`/api/tasks/events?${query.toString()}`, {
    withCredentials: true,
  });

  const handleMessage = (event: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(event.data) as BackgroundTasksApiSnapshot);
    } catch {
      onEvent(null);
    }
  };

  source.addEventListener('task.snapshot', handleMessage);
  source.addEventListener('task.updated', handleMessage);
  source.addEventListener('batch.readiness', handleMessage);
  source.onerror = () => onError?.();

  return () => source.close();
}

