import { isTauri } from '@/lib/tauri-web-view';

/** Native window chrome inset (traffic lights / caption buttons). */
export const TITLEBAR_NATIVE_INSET_PX = 86;

/** Sidebar toggle + back + forward over the expanded left rail. */
export const TITLEBAR_CONTROLS_WIDTH_PX = 28 * 3 + 12;

const PANEL_BASE_PADDING_PX = 8;
const PANEL_MAXIMIZED_THRESHOLD_PX = 16;
const COLLAPSED_LEADING_INSET_PX = 8;

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

/** Left inset for titlebar controls over the left rail (macOS traffic lights). */
export function titlebarLeadingInset(sidebarOpen: boolean): number {
  if (!sidebarOpen) {
    if (isTauri() && isMacPlatform()) return TITLEBAR_NATIVE_INSET_PX;
    return COLLAPSED_LEADING_INSET_PX;
  }
  return TITLEBAR_NATIVE_INSET_PX;
}

export function titlebarOverlayWidth(sidebarOpen: boolean, sidebarWidth: number): number {
  if (sidebarOpen) return sidebarWidth;
  return titlebarLeadingInset(false) + 28;
}

/** Space to reserve under the global sidebar trigger when the left rail is collapsed. */
export function collapsedSidebarTriggerReservePx(): number {
  return titlebarLeadingInset(false) + 28 + 4;
}

export function isRightPanelNearlyMaximized(
  rightOpen: boolean,
  rightWidth: number,
  availableWidth: number,
  rightMax: number,
): boolean {
  if (!rightOpen || availableWidth <= 0) return false;
  return rightWidth >= rightMax - PANEL_MAXIMIZED_THRESHOLD_PX;
}

/** Tab bar left padding. Chrome is inlined when the left rail is collapsed and maximized. */
export function panelTabBarPaddingLeft(): number {
  return PANEL_BASE_PADDING_PX;
}
