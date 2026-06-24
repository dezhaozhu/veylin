import { useCallback, useState } from 'react';
import { getPanelKindDef } from './panel-registry';
import type { PanelKind, PanelTab } from './panel-types';

const STORAGE_KEY = 'right_panel_tabs';

type StoredState = {
  tabs: PanelTab[];
  activeId: string | null;
};

function createTab(kind: PanelKind): PanelTab {
  const def = getPanelKindDef(kind);
  return {
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    kind,
    title: def?.defaultTitle ?? kind,
    ...(def?.createState ? { state: def.createState() } : {}),
  };
}

function seededState(): StoredState {
  const tab = createTab('table');
  return { tabs: [tab], activeId: tab.id };
}

function isValidTab(value: unknown): value is PanelTab {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<PanelTab>;
  return (
    typeof t.id === 'string' &&
    typeof t.kind === 'string' &&
    getPanelKindDef(t.kind as PanelKind) != null &&
    typeof t.title === 'string'
  );
}

function readState(): StoredState {
  if (typeof window === 'undefined') return seededState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seededState();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isValidTab) : [];
    if (tabs.length === 0) return seededState();
    const activeId =
      typeof parsed.activeId === 'string' && tabs.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : tabs[0]!.id;
    return { tabs, activeId };
  } catch {
    return seededState();
  }
}

function writeState(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

export interface PanelTabsApi {
  tabs: PanelTab[];
  activeId: string | null;
  activeTab: PanelTab | null;
  open: (kind: PanelKind) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  updateState: (id: string, patch: Record<string, unknown>) => void;
}

/** Right-panel tab store. Mount once (single consumer); persists to localStorage. */
export function usePanelTabs(): PanelTabsApi {
  const [state, setState] = useState<StoredState>(() => readState());

  const commit = useCallback((next: StoredState) => {
    setState(next);
    writeState(next);
  }, []);

  const open = useCallback(
    (kind: PanelKind) => {
      const tab = createTab(kind);
      commit({ tabs: [...state.tabs, tab], activeId: tab.id });
    },
    [state.tabs, commit],
  );

  const close = useCallback(
    (id: string) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeId = state.activeId;
      if (activeId === id) {
        const fallback = tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null;
        activeId = fallback?.id ?? null;
      }
      commit({ tabs, activeId });
    },
    [state.tabs, state.activeId, commit],
  );

  const activate = useCallback(
    (id: string) => {
      if (id === state.activeId) return;
      if (!state.tabs.some((t) => t.id === id)) return;
      commit({ tabs: state.tabs, activeId: id });
    },
    [state.tabs, state.activeId, commit],
  );

  const updateState = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const tabs = state.tabs.map((t) =>
        t.id === id ? { ...t, state: { ...t.state, ...patch } } : t,
      );
      commit({ tabs, activeId: state.activeId });
    },
    [state.tabs, state.activeId, commit],
  );

  const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? null;

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab,
    open,
    close,
    activate,
    updateState,
  };
}
