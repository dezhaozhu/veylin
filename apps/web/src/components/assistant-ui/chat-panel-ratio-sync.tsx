import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  SIDEBAR_WIDTH_ICON_PX,
  useRightSidebar,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  chatRatioToRightWidth,
  readChatPanelRatio,
  readChatWorkspaceWidth,
  resolveRightPanelOpenWidth,
  rightPanelWidthMax,
  rightWidthToChatRatio,
  writeChatPanelRatio,
} from '@/lib/chat-panel-ratio';

const RIGHT_SIDEBAR_WIDTH_MIN = 280;

function workspaceAvailableWidth(leftOpen: boolean, leftWidth: number): number {
  // Icon-collapsed left rail still occupies SIDEBAR_WIDTH_ICON_PX.
  const leftOccupied = leftOpen ? leftWidth : SIDEBAR_WIDTH_ICON_PX;
  const estimated = Math.max(
    320,
    window.innerWidth - leftOccupied,
  );
  const measured = readChatWorkspaceWidth();
  // Prefer estimate right after the left rail opens — layout may lag one frame.
  if (leftOpen && measured > estimated + 8) {
    return estimated;
  }
  if (measured > 0) return measured;
  return estimated;
}

/**
 * Keeps chat_panel_ratio and right sidebar width in sync (0–95% chat share).
 * Mount once inside SidebarProvider + RightSidebarProvider.
 */
export function ChatPanelRatioSync() {
  const { open: leftOpen, width: leftWidth } = useSidebar();
  const { open: rightOpen, width: rightWidth, setWidth } = useRightSidebar();
  const syncedRef = useRef(false);

  // When the right panel opens, apply stored ratio once.
  useEffect(() => {
    if (!rightOpen) {
      syncedRef.current = false;
      return;
    }
    if (syncedRef.current) return;
    const avail = workspaceAvailableWidth(leftOpen, leftWidth);
    setWidth(resolveRightPanelOpenWidth(avail, RIGHT_SIDEBAR_WIDTH_MIN));
    syncedRef.current = true;
  }, [rightOpen, leftOpen, leftWidth, setWidth]);

  // When the left rail opens, shrink an oversized right panel so the thread list stays visible.
  useLayoutEffect(() => {
    if (!rightOpen) return;
    const avail = workspaceAvailableWidth(leftOpen, leftWidth);
    const max = rightPanelWidthMax(avail, RIGHT_SIDEBAR_WIDTH_MIN);
    if (rightWidth > max) {
      setWidth(max);
    }
  }, [rightOpen, leftOpen, leftWidth, rightWidth, setWidth]);

  // Re-apply ratio when the window or left sidebar width changes.
  useEffect(() => {
    if (!rightOpen) return;
    const onResize = () => {
      const avail = workspaceAvailableWidth(leftOpen, leftWidth);
      const ratio = readChatPanelRatio();
      setWidth(
        chatRatioToRightWidth(
          ratio,
          avail,
          RIGHT_SIDEBAR_WIDTH_MIN,
          rightPanelWidthMax(avail, RIGHT_SIDEBAR_WIDTH_MIN),
        ),
      );
    };
    // leftWidth is in deps — re-apply immediately when the left rail is dragged.
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [rightOpen, leftOpen, leftWidth, setWidth]);

  // Persist ratio whenever right width changes (e.g. drag handle).
  useEffect(() => {
    if (!rightOpen) return;
    const avail = workspaceAvailableWidth(leftOpen, leftWidth);
    writeChatPanelRatio(rightWidthToChatRatio(rightWidth, avail));
  }, [rightOpen, rightWidth, leftOpen, leftWidth]);

  return null;
}
