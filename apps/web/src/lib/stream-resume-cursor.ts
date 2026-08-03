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

/** @deprecated Prefer advanceCursorBySseBytes — TCP chunks ≠ store entries. */
export function nextCursorAfterChunk(prevCursor: string): string {
  const seq = cursorToSequenceNum(prevCursor) + 1;
  return seq.toString(36);
}

export type AdvanceCursorBySseResult = {
  cursor: string;
  /** Incomplete trailing SSE frame (no closing \\n\\n yet). */
  carry: string;
};

/** Store only keeps JsonToSse `data:` frames; ignore wire `: comment` keepalives. */
function isResumableStoreFrame(frame: string): boolean {
  return frame.trimStart().startsWith('data:');
}

/**
 * Advance resume cursor by complete SSE `data:` frames (`\\n\\n`-delimited),
 * matching resumable store entries (one JsonToSseTransformStream enqueue ≈ one entry).
 * Comment frames (`: keepalive`) on the socket are ignored.
 */
export function advanceCursorBySseBytes(
  prevCursor: string,
  chunk: Uint8Array,
  carry = '',
  decoder = new TextDecoder(),
): AdvanceCursorBySseResult {
  const text = carry + decoder.decode(chunk, { stream: true });
  let frames = 0;
  let start = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '\n' && text[i + 1] === '\n') {
      const frame = text.slice(start, i);
      if (isResumableStoreFrame(frame)) frames += 1;
      start = i + 2;
      i += 1;
    }
  }
  const nextCarry = text.slice(start);
  if (frames === 0) {
    return { cursor: prevCursor, carry: nextCarry };
  }
  const seq = cursorToSequenceNum(prevCursor) + frames;
  return { cursor: seq.toString(36), carry: nextCarry };
}
