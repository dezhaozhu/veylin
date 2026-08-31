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
  // 落点也留一份 ref:提交**不能**写在 setState 的 updater 里 —— StrictMode 会把
  // updater 双调用来暴露副作用,那就等于 onDrop 交两次(眼下 moveTabToPane 幂等,
  // 侥幸看不出来,但这是个等着被踩的形状)。updater 保持纯的,提交在外面做。
  const dragRef = useRef<TabDragState | null>(null);
  const setDragState = useCallback((next: TabDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onTabPointerDown = useCallback(
    (tabId: string, event: React.PointerEvent<HTMLElement>) => {
      // 只认主键;右键/中键有各自的语义,别劫持。
      if (event.button !== 0) return;
      // 上一次拖拽还挂着(丢了 pointerup 之类)就先中止它 —— 否则两套 window
      // 监听并存,cleanupRef 只指向新的那套,旧的永远摘不掉。
      cleanupRef.current?.();
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
        setDragState(compute(e.clientX, e.clientY));
      };

      const finish = (commit: boolean) => {
        // cleanup 自身幂等(第一件事就是把 cleanupRef 清空),所以 pointerup 和
        // Escape 抢着到也只会走一次。
        if (!cleanupRef.current) return;
        // 落点要在 cleanup **之前**读 —— cleanup 会把拖拽状态收掉。
        const current = dragRef.current;
        const didStart = started;
        cleanupRef.current();
        if (didStart && commit && current?.target) {
          argsRef.current.onDrop(current.tabId, current.target.pane);
        }
      };

      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish(false);
      };

      // **一切收摊都在 cleanup 里**,不在 finish 里 —— 这样每条退出路径都会走到:
      // 松手、Esc、指针取消、组件卸载,以及"上一次拖拽丢了 pointerup、由下一次
      // 按下来兜底中止"。浮影/预览的收起曾经只写在 finish 里,那条兜底路径就把
      // 它们永久留在了屏幕上(评审抓到)。
      cleanupRef.current = () => {
        cleanupRef.current = null;
        setDragState(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
        // 只有真藏过才需要恢复 —— 没过阈值的那次点击不该白白惊动原生层。
        if (started && isTauri()) {
          // 排到下一帧:紧接着的 onDrop 会把面板挪位置,现在就恢复等于按**旧**坐标
          // 显示原生层,会闪一下(拖的正好是 web 页签时最明显)。
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent(PANEL_WEB_VIEW_RESTORE_EVENT));
          });
        }
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
