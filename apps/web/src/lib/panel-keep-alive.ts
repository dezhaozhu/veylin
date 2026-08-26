import type { PanelKind, PanelTab } from '../components/assistant-ui/right-panel/panel-types.js';

/**
 * 右栏默认只挂当前页签。排产表一次灌进约 3 万行,切去甘特再点回来等于整表重挂,
 * 定位看起来像"表格半天不出来"。表格先开过后保活(看不见时卸显示、不卸实例)。
 * 甘特不进这里:dhtmlx 在 display:none / 零尺寸里容易把时间轴算坏,窗口重拉也比
 * 灌 3 万行便宜。
 */
export const KEEP_ALIVE_PANEL_KINDS = new Set<PanelKind>(['table']);

export function splitPanelRender(
  tabs: PanelTab[],
  activeId: string | null,
): { keepAlive: PanelTab[]; activeEphemeral: PanelTab | null } {
  const keepAlive = tabs.filter((tab) => KEEP_ALIVE_PANEL_KINDS.has(tab.kind));
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const activeEphemeral =
    active && !KEEP_ALIVE_PANEL_KINDS.has(active.kind) ? active : null;
  return { keepAlive, activeEphemeral };
}
