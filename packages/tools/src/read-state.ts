import { resolve } from 'node:path';

/**
 * Per-thread file read snapshots, modelled after the agent's FileReadTool
 * freshness/dedup tracking:
 *
 *  - After file_read records the file's {mtimeMs,size}. A subsequent read of the
 *    same unchanged file can return a compact "unchanged" stub instead of
 *    re-sending the full content (saves tokens).
 *  - file_write / file_edit check the snapshot before writing: if the file
 *    changed on disk since the agent last read it, the write is rejected so the
 *    agent re-reads first and does not clobber external edits.
 *
 * State is module-level and keyed by `${threadId}:${absolutePath}`. It is a best
 * effort cache; a missing snapshot simply means "no info", never an error.
 */

export interface FileSnapshot {
  mtimeMs: number;
  size: number;
  /** When this snapshot was taken (ms since epoch). */
  readAt: number;
}

const snapshots = new Map<string, FileSnapshot>();

const DEFAULT_THREAD = '__default__';

function keyFor(threadId: string | undefined, absPath: string): string {
  return `${threadId || DEFAULT_THREAD}:${absPath}`;
}

export function absPathOf(path: string): string {
  return resolve(path);
}

/** Record a snapshot after a successful read. */
export function recordRead(
  threadId: string | undefined,
  path: string,
  stat: { mtimeMs?: number; size?: number },
): void {
  if (stat.mtimeMs == null || stat.size == null) return;
  snapshots.set(keyFor(threadId, absPathOf(path)), {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    readAt: Date.now(),
  });
}

export function getSnapshot(threadId: string | undefined, path: string): FileSnapshot | undefined {
  return snapshots.get(keyFor(threadId, absPathOf(path)));
}

/**
 * True when the file is unchanged since the recorded snapshot (same mtime+size).
 * Returns false when there is no snapshot or either value differs.
 */
export function isUnchangedSinceRead(
  threadId: string | undefined,
  path: string,
  current: { mtimeMs?: number; size?: number },
): boolean {
  const snap = getSnapshot(threadId, path);
  if (!snap) return false;
  if (current.mtimeMs == null || current.size == null) return false;
  return snap.mtimeMs === current.mtimeMs && snap.size === current.size;
}

/**
 * Guard for mutating tools. Returns an error message string when the file was
 * modified on disk after the agent last read it (stale snapshot), or `null`
 * when the write may proceed (either fresh, or never read — we only block on a
 * positive mismatch, mirroring read-before-write rather than read-mandatory).
 */
export function staleWriteError(
  threadId: string | undefined,
  path: string,
  current: { mtimeMs?: number; size?: number },
): string | null {
  const snap = getSnapshot(threadId, path);
  if (!snap) return null;
  if (current.mtimeMs == null) return null;
  if (current.mtimeMs > snap.mtimeMs || current.size !== snap.size) {
    return (
      `File "${absPathOf(path)}" has changed on disk since you last read it ` +
      `(read at mtime ${snap.mtimeMs}/${snap.size}B, now ${current.mtimeMs}/${current.size}B). ` +
      `Re-read it with file_read before editing so you don't overwrite external changes.`
    );
  }
  return null;
}

/** Stub returned in place of full content when a re-read finds no changes. */
export function unchangedStub(path: string): string {
  return (
    `FILE_UNCHANGED: "${absPathOf(path)}" has not changed since you last read it. ` +
    `Reusing the previously read content; no need to re-read.`
  );
}

/** Test/maintenance helper. */
export function clearReadState(): void {
  snapshots.clear();
}
