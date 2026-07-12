import type { PanelKind, PanelTab } from '@/components/assistant-ui/right-panel/panel-types';

const BY_THREAD_STORAGE_KEY = 'right_panel_tabs_by_thread';

const KNOWN_KINDS = new Set<PanelKind>(['table', 'web', 'rag', 'workflow']);

export type PanelTabsStoredState = {
  tabs: PanelTab[];
  activeId: string | null;
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

function normalizeState(parsed: Partial<PanelTabsStoredState> | null | undefined): PanelTabsStoredState {
  const tabs = (Array.isArray(parsed?.tabs) ? parsed!.tabs.filter(isValidTab) : []).map((tab) => {
    if (tab.kind !== 'web') return tab;
    return {
      ...tab,
      // Keep kind label stable; page titles live in tab.state.
      title: tab.title || 'panels.web.label',
    };
  });
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

/** Snapshot of the active right-panel tab for chat request body. */
export function readWorkspacePanelContext():
  | {
      activePanel: PanelKind;
      webUrl?: string;
      webTitle?: string;
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
  } = { activePanel: tab.kind };
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
