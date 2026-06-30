import { inputTokenLimit } from './token-limit';

const DEFAULT_AUTOCOMPACT_PCT = 0.85;
const DEFAULT_AUTOCOMPACT_BUFFER = 13_000;
const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveCompactFailures = 0;
let autoCompactDisabled = false;

function envFloat(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function getContextWindowSize(): number {
  return inputTokenLimit();
}

export function getAutoCompactThreshold(): number {
  const window = getContextWindowSize();
  const pct = envFloat('VEYLIN_AUTOCOMPACT_PCT', DEFAULT_AUTOCOMPACT_PCT);
  const buffer = envFloat('VEYLIN_AUTOCOMPACT_BUFFER', DEFAULT_AUTOCOMPACT_BUFFER);
  const override = process.env.VEYLIN_AUTOCOMPACT_WINDOW?.trim();
  const effectiveWindow = override ? Math.min(window, Number(override) || window) : window;
  return Math.max(1000, Math.floor(effectiveWindow * pct) - buffer);
}

export function isAutoCompactDisabled(): boolean {
  return autoCompactDisabled;
}

export function recordCompactSuccess(): void {
  consecutiveCompactFailures = 0;
  autoCompactDisabled = false;
}

export function recordCompactFailure(): void {
  consecutiveCompactFailures += 1;
  if (consecutiveCompactFailures >= MAX_CONSECUTIVE_FAILURES) {
    autoCompactDisabled = true;
  }
}

export function resetCompactCircuitBreaker(): void {
  consecutiveCompactFailures = 0;
  autoCompactDisabled = false;
}
