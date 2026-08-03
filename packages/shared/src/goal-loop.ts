/** Thread-scoped goal (Claude-style) and loop (interval) contracts. */

export const DEFAULT_GOAL_MAX_TURNS = 100;
export const DEFAULT_LOOP_MAX_AGE_DAYS = 7;
export const LOOP_WAKEUP_MIN_SECONDS = 15;
export const LOOP_WAKEUP_MAX_SECONDS = 3600;
export const LOOP_SCHEDULE_WAKEUP_TOOL = 'loop_schedule_wakeup' as const;
export const LOOP_SET_TOOL = 'loop_set' as const;

export type ThreadGoalStatus = 'active' | 'achieved' | 'cleared' | 'max_turns';

export interface ThreadGoalState {
  condition: string;
  status: ThreadGoalStatus;
  turnsEvaluated: number;
  maxTurns: number;
  lastEvalReason?: string;
  /** Set by server after eval; client clears when auto-continuing. */
  needsContinuation?: boolean;
  startedAt: string;
  updatedAt: string;
}

export type ThreadLoopMode = 'fixed' | 'dynamic';
export type ThreadLoopStatus = 'active' | 'stopped';

export interface ThreadLoopState {
  prompt: string;
  mode: ThreadLoopMode;
  intervalSeconds?: number;
  nextWakeAt?: string;
  jobId: string;
  status: ThreadLoopStatus;
  maxAgeDays: number;
  createdAt: string;
  /** Dynamic mode: agent requested stop. */
  stopRequested?: boolean;
}

export function isGoalActive(goal: ThreadGoalState | null | undefined): boolean {
  return goal?.status === 'active';
}

export function isLoopActive(loop: ThreadLoopState | null | undefined): boolean {
  return loop?.status === 'active';
}

export function parseIntervalToSeconds(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]!.toLowerCase();
  if (unit === 's') return Math.max(1, n);
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  return null;
}

function unitToSeconds(n: number, unit: string): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = unit.toLowerCase();
  if (u === 's' || u === 'sec' || u === 'secs' || u === 'second' || u === 'seconds' || u === '秒') {
    return Math.max(1, n);
  }
  if (
    u === 'm' ||
    u === 'min' ||
    u === 'mins' ||
    u === 'minute' ||
    u === 'minutes' ||
    u === '分' ||
    u === '分钟'
  ) {
    return n * 60;
  }
  if (
    u === 'h' ||
    u === 'hr' ||
    u === 'hrs' ||
    u === 'hour' ||
    u === 'hours' ||
    u === '时' ||
    u === '小时'
  ) {
    return n * 3600;
  }
  if (u === 'd' || u === 'day' || u === 'days' || u === '天') {
    return n * 86400;
  }
  return null;
}

/**
 * Find a cadence in free-form text (e.g. "5m", "每10分钟检查 CI", "every 2 hours").
 * Returns the first match; prefers explicit compact forms like `5m`.
 */
export function extractIntervalFromText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const whole = parseIntervalToSeconds(trimmed);
  if (whole != null) return whole;

  const unit =
    'seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|分钟|小时|秒钟|秒|分|时|天|[smhd]';
  const patterns: RegExp[] = [
    new RegExp(`(?:every|每)\\s*(\\d+)\\s*(${unit})(?![a-zA-Z])`, 'i'),
    new RegExp(`(?<![a-zA-Z\\d])(\\d+)\\s*(${unit})(?![a-zA-Z])`, 'i'),
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (!m) continue;
    const seconds = unitToSeconds(Number(m[1]), m[2]!);
    if (seconds != null) return seconds;
  }
  return null;
}

export function formatIntervalSeconds(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function clampLoopWakeupSeconds(seconds: number): number {
  return Math.min(
    LOOP_WAKEUP_MAX_SECONDS,
    Math.max(LOOP_WAKEUP_MIN_SECONDS, Math.floor(seconds)),
  );
}
