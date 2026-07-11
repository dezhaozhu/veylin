import { useCallback, useState } from 'react';
import { closeWebView, isTauri } from '@/lib/tauri-web-view';
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
    const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs.filter(isValidTab) : []).map(
      (tab) => {
        if (tab.kind !== 'web') return tab;
        const def = getPanelKindDef('web');
        return {
          ...tab,
          title: def?.defaultTitle ?? 'panels.web.label',
        };
      },
    );
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
  /** Focus a web tab and show it in the docked browser (for @ context). */
  focusWebTab: (id: string) => Promise<void>;
  /** Open/focus the knowledge panel and highlight a citation excerpt. */
  focusRagCitation: (focus: { refIndex?: number; chunkId?: string }) => void;
}

/** Right-panel tab store. Use via PanelTabsProvider / usePanelTabs(). */
export function usePanelTabsState(): PanelTabsApi {
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
      const closing = state.tabs.find((t) => t.id === id);
      if (closing?.kind === 'web' && isTauri()) {
        void closeWebView(id);
      }
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
      const tabs = state.tabs.map((t) => {
        if (t.id !== id) return t;
        const next: PanelTab = {
          ...t,
          state: { ...t.state, ...patch },
        };
        // Web tabs keep the kind label ("Web"); page titles live in tab.state.
        if (
          t.kind !== 'web' &&
          typeof patch.title === 'string' &&
          patch.title.trim()
        ) {
          next.title = patch.title.trim();
        }
        return next;
      });
      commit({ tabs, activeId: state.activeId });
    },
    [state.tabs, state.activeId, commit],
  );

  const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? null;

  const focusWebTab = useCallback(
    async (id: string) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab || tab.kind !== 'web') return;
      if (id !== state.activeId) {
        commit({ tabs: state.tabs, activeId: id });
      }
    },
    [state.tabs, state.activeId, commit],
  );

  const focusRagCitation = useCallback(
    (focus: { refIndex?: number; chunkId?: string }) => {
      const existing = state.tabs.find((t) => t.kind === 'rag');
      const ragFocus = { ...focus, at: Date.now() };
      if (existing) {
        const tabs = state.tabs.map((t) =>
          t.id === existing.id
            ? { ...t, state: { ...t.state, ragFocus, ragSubTab: 'citations' } }
            : t,
        );
        commit({ tabs, activeId: existing.id });
        return;
      }
      const tab = createTab('rag');
      tab.state = { ragFocus, ragSubTab: 'citations' };
      commit({ tabs: [...state.tabs, tab], activeId: tab.id });
    },
    [state.tabs, commit],
  );

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab,
    open,
    close,
    activate,
    updateState,
    focusWebTab,
    focusRagCitation,
  };
}
