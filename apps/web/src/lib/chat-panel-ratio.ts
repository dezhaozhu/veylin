/** Fraction of the chat+workspace area given to the chat column (0.3–0.8). */
export const CHAT_PANEL_RATIO_STORAGE_KEY = 'chat_panel_ratio';
export const CHAT_PANEL_RATIO_MIN = 0.3;
export const CHAT_PANEL_RATIO_MAX = 0.8;
export const CHAT_PANEL_RATIO_DEFAULT = 0.55;

export function clampChatPanelRatio(ratio: number): number {
  return Math.min(
    CHAT_PANEL_RATIO_MAX,
    Math.max(CHAT_PANEL_RATIO_MIN, Math.round(ratio * 1000) / 1000),
  );
}

export function readChatPanelRatio(): number {
  if (typeof window === 'undefined') return CHAT_PANEL_RATIO_DEFAULT;
  try {
    const raw = localStorage.getItem(CHAT_PANEL_RATIO_STORAGE_KEY);
    if (!raw) return CHAT_PANEL_RATIO_DEFAULT;
    const value = Number(raw);
    if (!Number.isFinite(value)) return CHAT_PANEL_RATIO_DEFAULT;
    return clampChatPanelRatio(value);
  } catch {
    return CHAT_PANEL_RATIO_DEFAULT;
  }
}

export function writeChatPanelRatio(ratio: number): void {
  try {
    localStorage.setItem(
      CHAT_PANEL_RATIO_STORAGE_KEY,
      String(clampChatPanelRatio(ratio)),
    );
  } catch {
    // ignore quota / private mode
  }
}

/** Map chat ratio → right sidebar pixel width within [min, max]. */
export function chatRatioToRightWidth(
  chatRatio: number,
  availableWidth: number,
  rightMin: number,
  rightMax: number,
): number {
  const rightFraction = 1 - clampChatPanelRatio(chatRatio);
  const target = Math.round(rightFraction * availableWidth);
  return Math.min(rightMax, Math.max(rightMin, target));
}

/** Map right sidebar width → chat ratio. */
export function rightWidthToChatRatio(
  rightWidth: number,
  availableWidth: number,
): number {
  if (availableWidth <= 0) return CHAT_PANEL_RATIO_DEFAULT;
  return clampChatPanelRatio(1 - rightWidth / availableWidth);
}
