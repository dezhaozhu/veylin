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
import { useEffect, type FC } from 'react';

import { useRightSidebar } from '@/components/ui/sidebar';
import { usePanelTabs } from './panel-tabs-context';

export const DevPanelOpener: FC = () => {
  const api = usePanelTabs();
  const { setOpen } = useRightSidebar();

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import('@/lib/dev-test-hooks').then((m) =>
      m.registerDevPanelOpener(() => {
        setOpen(true);
        void api.open('table');
      }),
    );
  }, [api, setOpen]);

  return null;
};
