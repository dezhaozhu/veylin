/** Client plan mode cache + API sync; inference lives in @veylin/shared. */

import { isPersistableThreadId } from './sync-thread-messages';

export {
  ENTER_PLAN_MODE_TOOL,
  EXIT_PLAN_MODE_TOOL,
  inferPlanModeFromMessages,
  inferPlanModeFromThreadMessages,
} from '@veylin/shared';

export async function fetchThreadPlanMode(threadId: string): Promise<boolean> {
  if (!isPersistableThreadId(threadId)) return false;
  const res = await fetch(`/api/plan-mode?threadId=${encodeURIComponent(threadId)}`);
  if (!res.ok) return false;
  const data = (await res.json()) as { planMode?: boolean };
  return data.planMode === true;
}

const planModeByThread = new Map<string, boolean>();

export function readCachedThreadPlanMode(threadId: string | undefined): boolean | null {
  if (!threadId) return null;
  return planModeByThread.has(threadId) ? planModeByThread.get(threadId)! : null;
}

export function writeCachedThreadPlanMode(threadId: string, on: boolean): void {
  planModeByThread.set(threadId, on);
}
