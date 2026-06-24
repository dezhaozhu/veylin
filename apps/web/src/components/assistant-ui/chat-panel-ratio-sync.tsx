import { useEffect, useRef } from 'react';
import { useRightSidebar, useSidebar } from '@/components/ui/sidebar';
import {
  chatRatioToRightWidth,
  readChatPanelRatio,
  rightWidthToChatRatio,
  writeChatPanelRatio,
} from '@/lib/chat-panel-ratio';

const RIGHT_SIDEBAR_WIDTH_MIN = 280;

function rightSidebarWidthMax() {
  if (typeof window === 'undefined') return 1200;
  return Math.min(1200, Math.floor(window.innerWidth * 0.85));
}

function workspaceAvailableWidth(leftOpen: boolean, leftWidth: number): number {
  const left = leftOpen ? leftWidth : 0;
  return Math.max(320, window.innerWidth - left);
}

/**
 * Keeps chat_panel_ratio and right sidebar width in sync (30–80% chat share).
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
    const ratio = readChatPanelRatio();
    const target = chatRatioToRightWidth(
      ratio,
      avail,
      RIGHT_SIDEBAR_WIDTH_MIN,
      rightSidebarWidthMax(),
    );
    setWidth(target);
    syncedRef.current = true;
  }, [rightOpen, leftOpen, leftWidth, setWidth]);

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
          rightSidebarWidthMax(),
        ),
      );
    };
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
