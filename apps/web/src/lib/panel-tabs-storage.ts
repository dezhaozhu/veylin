import type { PanelKind, PanelTab } from '@/components/assistant-ui/right-panel/panel-types';

const BY_THREAD_STORAGE_KEY = 'right_panel_tabs_by_thread';

// 落盘时认得的面板种类。**漏一种,那种页签刷新就没了** —— `doc` 和 `3d` 一直
// 不在这个集合里,所以在右侧打开的文档/模型从来撑不过一次刷新(2026-08-18 补)。
const KNOWN_KINDS = new Set<PanelKind>([
  'table', 'web', 'rag', 'workflow', 'doc', '3d', 'widget', 'gantt',
]);

/** Non-web panel kinds may only keep one tab per thread. */
const SINGLETON_PANEL_KINDS = new Set<PanelKind>(['table', 'rag', 'workflow']);

export type PanelTabsStoredState = {
  tabs: PanelTab[];
  activeId: string | null;
};

export type OpenWebTabHint = {
  tabId: string;
  url: string;
  title: string;
  isActive: boolean;
};

export function emptyPanelTabsState(): PanelTabsStoredState {
  return { tabs: [], activeId: null };
}

/** Live pointer — updated by PanelTabsProvider so non-React readers see the current thread. */
let liveThreadId: string | null = null;
let liveState: PanelTabsStoredState = emptyPanelTabsState();

export function setLivePanelThread(
  threadId: string | null,
  state: PanelTabsStoredState,
): void {
  liveThreadId = threadId;
  liveState = state;
}

export function getLivePanelThreadId(): string | null {
  return liveThreadId;
}

function isValidTab(value: unknown): value is PanelTab {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<PanelTab>;
  return (
    typeof t.id === 'string' &&
    typeof t.kind === 'string' &&
    KNOWN_KINDS.has(t.kind as PanelKind) &&
    typeof t.title === 'string'
  );
}

function dedupeSingletonTabs(
  tabs: PanelTab[],
  preferredActiveId: string | null | undefined,
): PanelTab[] {
  const keepIdByKind = new Map<PanelKind, string>();
  const preferred =
    typeof preferredActiveId === 'string'
      ? tabs.find((t) => t.id === preferredActiveId)
      : undefined;
  if (preferred && SINGLETON_PANEL_KINDS.has(preferred.kind)) {
    keepIdByKind.set(preferred.kind, preferred.id);
  }
  for (const tab of tabs) {
    if (!SINGLETON_PANEL_KINDS.has(tab.kind)) continue;
    if (!keepIdByKind.has(tab.kind)) keepIdByKind.set(tab.kind, tab.id);
  }
  return tabs.filter((tab) => {
    if (!SINGLETON_PANEL_KINDS.has(tab.kind)) return true;
    return keepIdByKind.get(tab.kind) === tab.id;
  });
}

function normalizeState(parsed: Partial<PanelTabsStoredState> | null | undefined): PanelTabsStoredState {
  const rawTabs = (Array.isArray(parsed?.tabs) ? parsed!.tabs.filter(isValidTab) : []).map((tab) => {
    if (tab.kind === 'web') {
      return {
        ...tab,
        // Keep kind label stable; page titles live in tab.state.
        title: tab.title || 'panels.web.label',
      };
    }
    if (tab.kind === 'widget') {
      // **不把整张图写进 localStorage。** 一张上重的甘特是 356 KB,而这里是所有
      // 线程共用一个 key、总额度约 5 MB —— 十来张就撑满,写失败还被 catch 吞掉,
      // 表现是所有面板页签一起悄悄失去持久化,没有任何报错。
      //
      // 图的数据本来就是"这一轮对话的产物":刷新后回对话里重开即可(面板的空状态
      // 就是这么说的)。页签只存**指向哪张图**。
      const { part: _dropped, ...rest } = (tab.state ?? {}) as Record<string, unknown>;
      return { ...tab, state: rest };
    }
    if (tab.kind === 'table') {
      return {
        ...tab,
        // Panel tab shows「表格」; sheet names live in the inner sheet strip.
        title: 'panels.table.label',
      };
    }
    return tab;
  });
  const tabs = dedupeSingletonTabs(rawTabs, parsed?.activeId ?? null);
  if (tabs.length === 0) return emptyPanelTabsState();
  const activeId =
    typeof parsed?.activeId === 'string' && tabs.some((t) => t.id === parsed.activeId)
      ? parsed.activeId
      : tabs[0]!.id;
  return { tabs, activeId };
}

function readByThreadMap(): Record<string, PanelTabsStoredState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BY_THREAD_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, PanelTabsStoredState> = {};
    for (const [threadId, value] of Object.entries(parsed)) {
      if (!threadId || !value || typeof value !== 'object') continue;
      out[threadId] = normalizeState(value as Partial<PanelTabsStoredState>);
    }
    return out;
  } catch {
    return {};
  }
}

function writeByThreadMap(map: Record<string, PanelTabsStoredState>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BY_THREAD_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

/** Load persisted tabs for a thread (empty if none). */
export function loadThreadPanelTabs(threadId: string | null): PanelTabsStoredState {
  if (!threadId) return emptyPanelTabsState();
  const map = readByThreadMap();
  return map[threadId] ? normalizeState(map[threadId]) : emptyPanelTabsState();
}

/** Persist tabs for a thread. Empty buckets are kept so "intentionally empty" survives reload. */
export function saveThreadPanelTabs(
  threadId: string | null,
  state: PanelTabsStoredState,
): void {
  if (!threadId) return;
  const map = readByThreadMap();
  map[threadId] = normalizeState(state);
  writeByThreadMap(map);
}

/**
 * Move panel workspace from a local list-item id to the server remoteId
 * (first message / initialize) so tabs are not lost.
 */
export function migrateThreadPanelTabs(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) return;
  const map = readByThreadMap();
  const from = map[fromId];
  if (!from) return;
  const to = map[toId];
  // Prefer non-empty source; don't clobber a richer destination.
  if (!to || to.tabs.length === 0) {
    map[toId] = normalizeState(from);
  }
  delete map[fromId];
  writeByThreadMap(map);
}

/** Read persisted/current right-panel tabs (for modules outside PanelTabsProvider). */
export function readPanelTabsState(): PanelTabsStoredState | null {
  if (typeof window === 'undefined') return null;
  // Prefer live state from the provider when available.
  if (liveThreadId != null) return liveState;
  return null;
}

/** Active web tab id, if the focused right-panel tab is a web panel. */
export function getActiveWebTabId(): string | null {
  const state = readPanelTabsState();
  if (!state?.activeId) return null;
  const tab = state.tabs.find((t) => t.id === state.activeId);
  return tab?.kind === ('web' as PanelKind) ? tab.id : null;
}

/** All open web tabs for agent workspace hints. */
export function listOpenWebTabs(): OpenWebTabHint[] {
  const state = readPanelTabsState();
  if (!state) return [];
  return state.tabs
    .filter((t) => t.kind === 'web')
    .map((t) => {
      const url = typeof t.state?.url === 'string' ? t.state.url.trim() : '';
      const pageTitle =
        typeof t.state?.title === 'string' ? t.state.title.trim() : '';
      return {
        tabId: t.id,
        url,
        title: pageTitle || t.title?.trim() || url || t.id,
        isActive: t.id === state.activeId,
      };
    });
}

/** Snapshot of the active right-panel tab for chat request body. */
export function readWorkspacePanelContext():
  | {
      activePanel: PanelKind;
      webUrl?: string;
      webTitle?: string;
      openWebTabs?: OpenWebTabHint[];
    }
  | undefined {
  const state = readPanelTabsState();
  if (!state?.activeId) return undefined;
  const tab = state.tabs.find((t) => t.id === state.activeId);
  if (!tab) return undefined;
  const ctx: {
    activePanel: PanelKind;
    webUrl?: string;
    webTitle?: string;
    openWebTabs?: OpenWebTabHint[];
  } = { activePanel: tab.kind };
  const openWebTabs = listOpenWebTabs().filter((t) => t.url);
  if (openWebTabs.length > 0) {
    ctx.openWebTabs = openWebTabs;
  }
  if (tab.kind === 'web') {
    const url = typeof tab.state?.url === 'string' ? tab.state.url.trim() : '';
    if (url) {
      ctx.webUrl = url;
      const pageTitle =
        typeof tab.state?.title === 'string' ? tab.state.title.trim() : '';
      ctx.webTitle = pageTitle || tab.title?.trim() || url;
    }
  }
  return ctx;
}

/**
 * 已经开着的同一份文档 tab。**同一份 = 同项目 + 同文件名** —— 同名但不同项目
 * 不是同一份(两个项目里可以各有一份「工艺.docx」)。
 */
export function findDocTab(
  tabs: ReadonlyArray<PanelTab>,
  doc: { projectId: string; name: string },
): PanelTab | undefined {
  return tabs.find((t) => {
    if (t.kind !== 'doc') return false;
    const st = t.state as { projectId?: string; name?: string } | undefined;
    return st?.projectId === doc.projectId && st?.name === doc.name;
  });
}
