import { isTauri } from '@/lib/tauri-web-view';

/** macOS traffic-light cluster inset. */
export const TITLEBAR_MAC_LEADING_INSET_PX = 86;

/** Compact leading inset when there are no native left chrome buttons. */
export const TITLEBAR_LEADING_INSET_PX = 8;

/**
 * Windows/Linux caption-button cluster width (min / max / close).
 * Matches typical Win11 caption hit targets (~46px × 3).
 */
export const TITLEBAR_CAPTION_TRAILING_INSET_PX = 138;

/** Sidebar toggle width over the expanded left rail. */
export const TITLEBAR_CONTROLS_WIDTH_PX = 28;

const PANEL_BASE_PADDING_PX = 8;
const PANEL_MAXIMIZED_THRESHOLD_PX = 16;

export type TitlebarPlatform = 'mac' | 'windows' | 'linux' | 'web';

export function detectTitlebarPlatform(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  platform = typeof navigator !== 'undefined' ? navigator.platform : '',
): TitlebarPlatform {
  if (!isTauri()) return 'web';
  if (/Mac|iPhone|iPad/i.test(platform) || /Mac OS X/i.test(userAgent)) return 'mac';
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'windows';
  if (/Linux/i.test(platform) || /Linux/i.test(userAgent)) return 'linux';
  return 'web';
}

/** True when the app draws its own caption buttons (frameless Win/Linux). */
export function usesCustomCaptionButtons(
  platform: TitlebarPlatform = detectTitlebarPlatform(),
): boolean {
  return platform === 'windows' || platform === 'linux';
}

/** Left inset for titlebar controls (macOS traffic lights vs compact). */
export function titlebarLeadingInset(
  _sidebarOpen = true,
  platform: TitlebarPlatform = detectTitlebarPlatform(),
): number {
  if (platform === 'mac') return TITLEBAR_MAC_LEADING_INSET_PX;
  return TITLEBAR_LEADING_INSET_PX;
}

/** Right inset so content/triggers clear native or custom caption buttons. */
export function titlebarTrailingInset(
  platform: TitlebarPlatform = detectTitlebarPlatform(),
): number {
  if (usesCustomCaptionButtons(platform)) return TITLEBAR_CAPTION_TRAILING_INSET_PX;
  return 8;
}

export function titlebarOverlayWidth(
  sidebarOpen: boolean,
  sidebarWidth: number,
  platform: TitlebarPlatform = detectTitlebarPlatform(),
): number {
  if (sidebarOpen) return sidebarWidth;
  return titlebarLeadingInset(false, platform) + 28;
}

/** Space to reserve under the global sidebar trigger when the left rail is collapsed. */
export function collapsedSidebarTriggerReservePx(
  platform: TitlebarPlatform = detectTitlebarPlatform(),
): number {
  return titlebarLeadingInset(false, platform) + 28 + 4;
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
