/**
 * Two small pure judgments pulled out of gantt-panel.tsx so they're covered by
 * a test instead of a one-time manual walkthrough — evaluation flagged both as
 * "取错会造成最难查的现象" spots:
 *
 *  - threadId derivation: get this wrong and the symptom is silent ("表格看得见,
 *    甘特看不见"), not a crash — nothing points you back here.
 *  - server error message passthrough: get this wrong and a specific, honest
 *    409/502 reason quietly turns into a generic "加载失败", and nobody notices
 *    because the panel still renders *something*.
 */

export type GanttThreadListItem = {
  id?: string | null;
  remoteId?: string | null;
  externalId?: string | null;
};

/**
 * Same remoteId-first fallback used elsewhere in this repo (table-grid.tsx,
 * mcp-app-tool.tsx): the local composer id is all a brand-new thread has;
 * once the thread's first message round-trips the server, it gets a
 * remoteId/externalId, and THAT is what the server-side scope resolver
 * (resolveCompassRequestScope) actually keys off. Getting the precedence
 * wrong doesn't error — it just silently resolves to the wrong (or no)
 * project pin.
 */
export function resolveGanttThreadId(item: GanttThreadListItem): string | undefined {
  return item.remoteId ?? item.externalId ?? item.id ?? undefined;
}

/**
 * Given the parsed JSON body of a non-ok `/api/gantt/window` response, pick
 * the text to show. The server's `message` is human-authored (the 409 "没钉
 * 项目" copy, or a 502 Compass error) and must survive verbatim to the user —
 * this must never quietly collapse into a generic fallback just because it's
 * convenient to have one string to render.
 */
export function ganttErrorMessage(
  body: { message?: unknown } | null | undefined,
  fallback: string,
): string {
  const msg = body?.message;
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}
