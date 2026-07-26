/**
 * Size-based rotation for the detached server-dev watchdog log.
 * Dev-only — not a user-facing cleanup setting.
 */
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

export const SERVER_DEV_LOG_MAX_BYTES = 50 * 1024 * 1024;
export const SERVER_DEV_LOG_KEEP = 2;

/**
 * If `logPath` exists and is at least `maxBytes`, rotate:
 *   .log.2 <- .log.1 <- .log  (drop oldest beyond `keep`)
 * Returns true when a rotation happened.
 */
export function rotateServerDevLogIfNeeded(
  logPath,
  {
    maxBytes = SERVER_DEV_LOG_MAX_BYTES,
    keep = SERVER_DEV_LOG_KEEP,
  } = {},
) {
  if (!existsSync(logPath)) return false;
  let size = 0;
  try {
    size = statSync(logPath).size;
  } catch {
    return false;
  }
  if (size < maxBytes) return false;

  for (let i = keep; i >= 1; i -= 1) {
    const src = i === 1 ? logPath : `${logPath}.${i - 1}`;
    const dest = `${logPath}.${i}`;
    if (!existsSync(src)) continue;
    try {
      if (existsSync(dest)) unlinkSync(dest);
      renameSync(src, dest);
    } catch {
      // Best-effort: a concurrent writer may race; next write still appends.
    }
  }
  return true;
}

export function serverDevLogPath(logDir) {
  return resolve(logDir, 'server-dev.log');
}
