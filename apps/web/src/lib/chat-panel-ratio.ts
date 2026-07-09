/** Fraction of the chat+workspace area given to the chat column (0–0.95). */
export const CHAT_PANEL_RATIO_STORAGE_KEY = 'chat_panel_ratio';
export const CHAT_WORKSPACE_SLOT = 'chat-workspace';
/** Minimum chat column width when the right panel is dragged to full width (px). */
export const CHAT_PANEL_MIN_PX = 0;
/** Minimum chat column width when the right panel is opened via the toggle (px). */
export const CHAT_PANEL_OPEN_MIN_PX = 360;
export const CHAT_PANEL_RATIO_MIN = 0;
export const CHAT_PANEL_RATIO_MAX = 0.95;
export const CHAT_PANEL_RATIO_DEFAULT = 0.55;

export function readChatWorkspaceWidth(): number {
  if (typeof window === 'undefined') return 320;
  const workspace = document.querySelector(`[data-slot="${CHAT_WORKSPACE_SLOT}"]`);
  if (workspace instanceof HTMLElement && workspace.clientWidth > 0) {
    return workspace.clientWidth;
  }
  return Math.max(320, window.innerWidth);
}

/** Max right-panel width within the chat workspace (full bleed when CHAT_PANEL_MIN_PX is 0). */
export function rightPanelWidthMax(
  availableWidth = readChatWorkspaceWidth(),
  rightMin = 280,
): number {
  return Math.max(rightMin, availableWidth - CHAT_PANEL_MIN_PX);
}

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

/**
 * Width to apply when the right panel is opened (toggle), not when dragged mid-session.
 * Avoids restoring a previous full-bleed width and swallowing the chat column.
 */
export function resolveRightPanelOpenWidth(
  availableWidth: number,
  rightMin: number,
): number {
  let ratio = readChatPanelRatio();
  if (ratio < 0.15) {
    ratio = CHAT_PANEL_RATIO_DEFAULT;
  }
  const max = rightPanelWidthMax(availableWidth, rightMin);
  const target = chatRatioToRightWidth(ratio, availableWidth, rightMin, max);
  const maxOnOpen = Math.max(rightMin, availableWidth - CHAT_PANEL_OPEN_MIN_PX);
  return Math.min(target, maxOnOpen);
}
