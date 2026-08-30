import { useCallback, useEffect, useRef, useState } from 'react';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import {
  exceedsDragThreshold,
  resolveDropTarget,
  type DropTarget,
} from '@/lib/panel-tab-drag';
import { PANEL_WEB_VIEW_RESTORE_EVENT } from './panel-events';

export type TabDragState = {
  tabId: string;
  from: 'top' | 'bottom';
  /** 指针视口坐标 —— 浮影跟着它走。 */
  x: number;
  y: number;
  target: DropTarget | null;
};

/**
 * 拖页签分屏。落点判定是纯函数(panel-tab-drag.ts),这里只管**手感**:
 * 超过阈值才算拖(否则点页签切换会变成微型拖拽)、浮影跟手、Esc 取消、
 * 桌面端拖动期间把原生 webview 藏起来(否则它会盖住浮影和预览 —— 和
 * 「+」菜单同一个坑,复用同一套藏/恢复)。
 *
 * 几何全部相对**右栏根元素**:上 pane 的 flexBasis 就是 ratio×根高,所以
 * 「ratio 处」既是分隔线也是落点边界,和 splitter 拖动用同一套坐标。
 */
export function useTabDrag(args: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  splitRatio: number | null;
  topTabCount: number;
  isBottomTab: (tabId: string) => boolean;
  onDrop: (tabId: string, pane: 'top' | 'bottom') => void;
}): {
  drag: TabDragState | null;
  onTabPointerDown: (tabId: string, event: React.PointerEvent<HTMLElement>) => void;
} {
  const [drag, setDrag] = useState<TabDragState | null>(null);
  // 每次 pointermove 都要读最新的几何/回调,但监听只在 pointerdown 装一次
  // —— 直接闭包捕获就会拿到按下那一刻的旧值(分屏比例边拖边变的情况下会错)。
  const argsRef = useRef(args);
  argsRef.current = args;
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onTabPointerDown = useCallback(
    (tabId: string, event: React.PointerEvent<HTMLElement>) => {
      // 只认主键;右键/中键有各自的语义,别劫持。
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let started = false;

      const compute = (x: number, y: number): TabDragState => {
        const { rootRef, splitRatio, topTabCount, isBottomTab } = argsRef.current;
        const rect = rootRef.current?.getBoundingClientRect();
        const from: 'top' | 'bottom' = isBottomTab(tabId) ? 'bottom' : 'top';
        const target = rect
          ? resolveDropTarget({
              pointerY: y,
              rect: { top: rect.top, height: rect.height },
              splitRatio,
              from,
              topTabCount,
            })
          : null;
        // 指针跑出右栏左右边界也不该给落点(不然拖到聊天区还亮着预览)。
        const insideX = rect ? x >= rect.left && x <= rect.right : false;
        return { tabId, from, x, y, target: insideX ? target : null };
      };

      const onMove = (e: PointerEvent) => {
        if (!started) {
          if (!exceedsDragThreshold(e.clientX - startX, e.clientY - startY)) return;
          started = true;
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
          // 桌面端:原生 webview 是独立图层,会盖住浮影和落点预览。
          if (isTauri()) void hideWebView(undefined, { force: true });
        }
        setDrag(compute(e.clientX, e.clientY));
      };

      const finish = (commit: boolean) => {
        cleanupRef.current?.();
        if (!started) return;
        setDrag((cur) => {
          if (commit && cur?.target) {
            argsRef.current.onDrop(cur.tabId, cur.target.pane);
          }
          return null;
        });
        // 落幕后把 webview 放回来(和「+」菜单关闭同一条路)。
        if (isTauri()) {
          window.dispatchEvent(new CustomEvent(PANEL_WEB_VIEW_RESTORE_EVENT));
        }
      };

      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish(false);
      };

      cleanupRef.current = () => {
        cleanupRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown);
    },
    [],
  );

  return { drag, onTabPointerDown };
}
