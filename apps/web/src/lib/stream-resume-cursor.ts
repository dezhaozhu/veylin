const CURSOR_KEY = 'veylin-resume-cursor';

/** Last consumed store sequence (base36), the agent Last-Event-ID equivalent. */
export function getResumeCursor(streamId: string): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(`${CURSOR_KEY}:${streamId}`) ?? '';
}

export function setResumeCursor(streamId: string, cursor: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(`${CURSOR_KEY}:${streamId}`, cursor);
}

export function clearResumeCursor(streamId: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(`${CURSOR_KEY}:${streamId}`);
}

export function cursorToSequenceNum(cursor: string): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 36);
  return Number.isNaN(n) ? 0 : n;
}

export function nextCursorAfterChunk(prevCursor: string): string {
  const seq = cursorToSequenceNum(prevCursor) + 1;
  return seq.toString(36);
}
