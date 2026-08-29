/**
 * 只在 DEV:把"打开表格面板"这件事交给 e2e。
 *
 * e2e 从前靠几何去点那个"选面板类型"的大卡片:右栏可能整个收着、可能开着却被
 * 左栏挤到视口外、卡片还在动画里 —— 三种情况轮流失败,红了却与产品无关
 * (实测让两条测试反复变红,我一度以为是产品坏了)。
 *
 * **必须放在 PanelTabsProvider 和 RightSidebarProvider 之内**:两个 hook 各属
 * 一个 Provider,放外面会在启动时抛错、整屏变成 "UI failed to load"(踩过)。
 * 光开 tab 也不够 —— 右栏收着的话面板在屏幕外,和没开一样。
 */
import { useEffect, useRef, type FC } from 'react';

import { useRightSidebar } from '@/components/ui/sidebar';
import { usePanelTabs } from './panel-tabs-context';

export const DevPanelOpener: FC = () => {
  const api = usePanelTabs();
  const { setOpen } = useRightSidebar();
  // 注册的闭包必须读**最新**的 api:注册发生在某次渲染的 effect 里,直接捕获
  // api 就是捕获那一刻的 tabs 快照 —— e2e 先 openPanel 再 moveTabToPane,
  // 陈闭包看不到刚开的页签(实测 "no open tab of kind rag")。
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import('@/lib/dev-test-hooks').then((m) => {
      m.registerDevPanelOpener(() => {
        setOpen(true);
        void apiRef.current.open('table');
      });
      // 分屏 e2e 同款入口:开面板/移 pane/读布局都走 API,几何不进判据。
      m.registerDevPanelSplitApi({
        openPanel: (kind) => {
          setOpen(true);
          void apiRef.current.open(kind as Parameters<typeof api.open>[0]);
        },
        moveTabToPane: (kind, pane) => {
          const tab = apiRef.current.tabs.find((t) => t.kind === kind);
          if (!tab) throw new Error(`dev: no open tab of kind ${kind}`);
          apiRef.current.moveTabToPane(tab.id, pane);
        },
        panelState: () => ({
          tabs: apiRef.current.tabs.map((t) => ({ id: t.id, kind: t.kind })),
          activeId: apiRef.current.activeId,
          split: apiRef.current.split,
        }),
      });
    });
  }, [setOpen]);

  return null;
};
