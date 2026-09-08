import { useCallback } from 'react';
import { useRightSidebar } from '@/components/ui/sidebar';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import { hasGantt } from '@/lib/schedule-locate';
import type { NavigateTarget } from '@/lib/correction-bridge';

/**
 * 排产即导航 · 唯一的落地 handler,两个入口共用:
 *  · 卡片点条 / cockpit「在甘特里看」→ postMessage(navigate) → McpAppActionBridge;
 *  · agent 调 `navigate` 工具 → NavigateToolUI 拿到刚发出的结果。
 *
 * 锚点只带 Compass 的身份,**去哪个面板在这里决定**:装了甘特 → 甘特面板
 * (作业/订单 → focusGanttJob 定位;视角 → 只切视角);没装 → 退到排产表定位
 * 同一道作业,不静默。先拉开右栏 —— 抽屉收着时开页签,人看到的是「点了没反应」
 * (openWidget 那条路的教训)。
 *
 * 必须在 PanelTabsProvider 与 RightSidebarProvider 之内使用。
 */
export function useNavigateAnchor(): (target: NavigateTarget) => void {
  const { focusScheduleFilter, focusGanttJob } = usePanelTabs();
  const { setOpen: setRightOpen } = useRightSidebar();
  return useCallback(
    (target: NavigateTarget) => {
      setRightOpen(true);
      const ganttOk = target.surface === 'gantt' && hasGantt();
      if (target.kind === 'resource') {
        // 资源锚点:甘特按资源视角翻到含这条泳道的那一页并高亮;没装甘特就用
        // 排产表按资源过滤 —— 同一个资源,两种地图。
        if (ganttOk) void focusGanttJob({ view: 'resource', lane: target.id, ...(target.at ? { fromDate: target.at } : {}) });
        else void focusScheduleFilter({ workshop: target.id });
        return;
      }
      if (target.kind === 'view') {
        // 视角锚点只对甘特有意义;没装甘特就打开排产表,不装模作样。
        if (ganttOk) void focusGanttJob({ view: target.id as 'resource' | 'workshop' | 'order', ...(target.at ? { fromDate: target.at } : {}) });
        else void focusScheduleFilter({});
        return;
      }
      const locate =
        target.kind === 'job'
          ? { jobId: target.id, ...(target.orderId ? { orderId: target.orderId } : {}) }
          : { orderId: target.id };
      if (ganttOk) {
        void focusGanttJob({ ...locate, ...(target.at ? { fromDate: target.at } : {}) });
        return;
      }
      void focusScheduleFilter(
        target.kind === 'job'
          ? { job_id: target.id, ...(target.orderId ? { order_id: target.orderId } : {}) }
          : { order_id: target.id },
      );
    },
    [focusGanttJob, focusScheduleFilter, setRightOpen],
  );
}
