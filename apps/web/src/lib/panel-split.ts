import type { PanelTab } from '@/components/assistant-ui/right-panel/panel-types';

/**
 * 右栏上下分屏的覆盖式描述。`tabs` 保持平铺不动 —— 一切现有读方
 * (storage 归一化、listOpenWebTabs、readWorkspacePanelContext、singleton
 * 去重)都按平铺读,分屏只是在旁边记「哪些页签在下 pane」。
 *
 * 不变式(本模块的操作维护,storage 归一化兜底):
 * - `bottomIds` 非空且 ⊆ tabs;上 pane(tabs − bottomIds)也非空 ——
 *   任一 pane 空 ⇒ 没有分屏这回事(undefined),不存「空 pane」。
 * - `topVisibleId` ∈ 上 pane,`bottomVisibleId` ∈ bottomIds。
 * - 全局 activeId 语义不变(最后交互的页签),且必须是它所在 pane 的
 *   visibleId —— active 的页签不可能被自己 pane 的别的页签盖着。
 */
export type PanelSplitState = {
  /** 下 pane 的页签 id,顺序即下条页签栏顺序。 */
  bottomIds: string[];
  topVisibleId: string;
  bottomVisibleId: string;
  /** 上 pane 占内容区高度的比例。 */
  ratio: number;
};

/** panel-split 的操作对整个页签状态进出 —— split 永远和 tabs/activeId 一起变。 */
export type SplitTabsState = {
  tabs: PanelTab[];
  activeId: string | null;
  split?: PanelSplitState;
};

export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;
export const SPLIT_RATIO_DEFAULT = 0.5;

export function clampSplitRatio(ratio: unknown): number {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export function splitLayout(
  tabs: readonly PanelTab[],
  split: PanelSplitState | undefined,
): { top: PanelTab[]; bottom: PanelTab[] } {
  if (!split) return { top: [...tabs], bottom: [] };
  const bottomSet = new Set(split.bottomIds);
  const byId = new Map(tabs.map((t) => [t.id, t] as const));
  return {
    top: tabs.filter((t) => !bottomSet.has(t.id)),
    // 下 pane 按 bottomIds 的顺序,不按 tabs 的顺序 —— 移动进来的先后就是页签顺序。
    bottom: split.bottomIds.map((id) => byId.get(id)).filter((t): t is PanelTab => Boolean(t)),
  };
}

/** 此刻真正可见的页签(1 个,分屏时 2 个)。webview 藏不藏、e2e 断言都看它。 */
export function visibleTabIds(state: SplitTabsState): string[] {
  if (state.split) return [state.split.topVisibleId, state.split.bottomVisibleId];
  return state.activeId ? [state.activeId] : [];
}

/**
 * 此刻有没有某种面板**可见**。
 *
 * **分屏之后「active 是不是这种」不再等价于「这种可不可见」** —— 它可以在
 * 非 active 的那个 pane 里好好开着。这条判定必须只有这一处:它曾经在
 * right-panel(藏 webview)和 AssistantChat(DesktopInteractionGuard)各写一份,
 * 分屏那刀只改了前一处,于是 web 开在下 pane、点一下上 pane 的表格就会把整个
 * 原生页面藏掉,而且没有任何东西会把它恢复(2026-09-01 评审挖出)。
 */
export function hasVisibleTabOfKind(state: SplitTabsState, kind: PanelTab['kind']): boolean {
  const visible = new Set(visibleTabIds(state));
  return state.tabs.some((t) => visible.has(t.id) && t.kind === kind);
}

/** 历史的关页签回退:优先右邻,再左邻,再第一个。在「某个 pane 的页签序列」里做。 */
function fallbackId(ids: readonly string[], closedIdx: number): string | null {
  return ids[closedIdx] ?? ids[closedIdx - 1] ?? ids[0] ?? null;
}

export function activateTab(state: SplitTabsState, id: string): SplitTabsState {
  if (id === state.activeId) return state;
  if (!state.tabs.some((t) => t.id === id)) return state;
  if (!state.split) return { ...state, activeId: id };
  const inBottom = state.split.bottomIds.includes(id);
  return {
    ...state,
    activeId: id,
    split: inBottom
      ? { ...state.split, bottomVisibleId: id }
      : { ...state.split, topVisibleId: id },
  };
}

export function closeTab(state: SplitTabsState, id: string): SplitTabsState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);

  if (!state.split) {
    let activeId = state.activeId;
    if (activeId === id) {
      activeId = fallbackId(tabs.map((t) => t.id), idx);
    }
    return { tabs, activeId };
  }

  const layout = splitLayout(state.tabs, state.split);
  const wasBottom = state.split.bottomIds.includes(id);
  const paneIds = (wasBottom ? layout.bottom : layout.top).map((t) => t.id);
  const paneIdx = paneIds.indexOf(id);
  const paneRest = paneIds.filter((pid) => pid !== id);

  // 所在 pane 关空了 → 分屏解除,剩下的都是普通单 pane。
  if (paneRest.length === 0) {
    const survivorVisible = wasBottom ? state.split.topVisibleId : state.split.bottomVisibleId;
    return { tabs, activeId: state.activeId === id ? survivorVisible : state.activeId };
  }

  const bottomIds = wasBottom ? paneRest : state.split.bottomIds;
  let { topVisibleId, bottomVisibleId } = state.split;
  // 关掉的是某 pane 的可见页 → 在**同 pane 内**回退,不跳去另一个 pane。
  if (wasBottom && bottomVisibleId === id) {
    bottomVisibleId = fallbackId(paneRest, paneIdx)!;
  } else if (!wasBottom && topVisibleId === id) {
    topVisibleId = fallbackId(paneRest, paneIdx)!;
  }
  const activeId =
    state.activeId === id ? (wasBottom ? bottomVisibleId : topVisibleId) : state.activeId;
  return { tabs, activeId, split: { ...state.split, bottomIds, topVisibleId, bottomVisibleId } };
}

export function moveTabToPane(
  state: SplitTabsState,
  id: string,
  pane: 'top' | 'bottom',
): SplitTabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  const inBottom = state.split?.bottomIds.includes(id) ?? false;
  if (pane === 'bottom' ? inBottom : !inBottom) return state;

  if (pane === 'bottom') {
    const layout = splitLayout(state.tabs, state.split);
    const topIds = layout.top.map((t) => t.id);
    // 上 pane 不许被掏空 —— 没有「只剩下 pane」的形态。
    if (topIds.length <= 1) return state;
    const topRest = topIds.filter((tid) => tid !== id);
    // 上 pane 的可见页:原来的还在就不动;被移走的正是它(或首次分屏时是 activeId
    // 本人)就回退到邻居。
    const prevTopVisible = state.split ? state.split.topVisibleId : state.activeId;
    const topVisibleId =
      prevTopVisible && topRest.includes(prevTopVisible)
        ? prevTopVisible
        : fallbackId(topRest, topIds.indexOf(id))!;
    return {
      ...state,
      activeId: id,
      split: {
        bottomIds: [...(state.split?.bottomIds ?? []), id],
        topVisibleId,
        bottomVisibleId: id,
        ratio: state.split?.ratio ?? SPLIT_RATIO_DEFAULT,
      },
    };
  }

  // pane === 'top'
  const split = state.split!;
  const bottomRest = split.bottomIds.filter((bid) => bid !== id);
  if (bottomRest.length === 0) {
    // 下 pane 空了 → 分屏解除。
    return { tabs: state.tabs, activeId: id };
  }
  const bottomVisibleId =
    split.bottomVisibleId === id
      ? fallbackId(bottomRest, split.bottomIds.indexOf(id))!
      : split.bottomVisibleId;
  return {
    ...state,
    activeId: id,
    split: { ...split, bottomIds: bottomRest, topVisibleId: id, bottomVisibleId },
  };
}

/**
 * 从 localStorage 来的任意值归一化成合法 split(或 undefined)。
 * 修不如砍:坏 id 过滤、可见页修到所在 pane、activeId 对齐;修完任一 pane 空
 * 就整个不要 —— 加载出一个「半坏的分屏」比没有分屏糟。
 */
export function normalizePanelSplit(
  tabs: readonly PanelTab[],
  activeId: string | null,
  raw: unknown,
): PanelSplitState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<PanelSplitState>;
  if (!Array.isArray(r.bottomIds)) return undefined;
  const tabIds = new Set(tabs.map((t) => t.id));
  const bottomIds = [...new Set(r.bottomIds.filter((id): id is string => typeof id === 'string' && tabIds.has(id)))];
  if (bottomIds.length === 0) return undefined;
  const bottomSet = new Set(bottomIds);
  const topIds = tabs.map((t) => t.id).filter((id) => !bottomSet.has(id));
  if (topIds.length === 0) return undefined;

  let topVisibleId =
    typeof r.topVisibleId === 'string' && topIds.includes(r.topVisibleId)
      ? r.topVisibleId
      : topIds[0]!;
  let bottomVisibleId =
    typeof r.bottomVisibleId === 'string' && bottomSet.has(r.bottomVisibleId)
      ? r.bottomVisibleId
      : bottomIds[0]!;
  // active 的页签不许被自己 pane 的别的页签盖着。
  if (activeId && bottomSet.has(activeId)) bottomVisibleId = activeId;
  else if (activeId && topIds.includes(activeId)) topVisibleId = activeId;

  return { bottomIds, topVisibleId, bottomVisibleId, ratio: clampSplitRatio(r.ratio) };
}
