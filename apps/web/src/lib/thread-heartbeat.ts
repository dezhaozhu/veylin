/**
 * 对话心跳该多勤。
 *
 * 目标/循环真在跑时要勤问(续跑、到点唤醒)。没有这些时还每 2 秒打空接口,
 * 是空转税:人少看不出来,人一多先爆的是 QPS。
 */

export const GOAL_LOOP_RUNNING_MS = 1_500;
export const GOAL_LOOP_ACTIVE_MS = 2_000;
export const GOAL_LOOP_EMPTY_MS = 30_000;
export const TODOS_RUNNING_MS = 1_500;
export const TODOS_IDLE_MS = 15_000;

/** 服务端还没认的本地草稿 id,打 goal/loop/todos 只会空转。 */
export function isServerThreadId(threadId: string | undefined): boolean {
  if (!threadId?.trim()) return false;
  return !/_LOCALID_/i.test(threadId);
}

export function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * 下一次该隔多久再问。`null` = 现在别问(页藏着)。
 * 对话在跑 / 目标或循环是 active → 勤问;否则拉到 30 秒。
 */
export function nextGoalLoopDelay(input: {
  visible: boolean;
  chatRunning: boolean;
  goalActive: boolean;
  loopActive: boolean;
}): number | null {
  if (!input.visible) return null;
  if (input.chatRunning) return GOAL_LOOP_RUNNING_MS;
  if (input.goalActive || input.loopActive) return GOAL_LOOP_ACTIVE_MS;
  return GOAL_LOOP_EMPTY_MS;
}
