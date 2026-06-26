import type { PanelKind, PanelTab } from '@/components/assistant-ui/right-panel/panel-types';

const STORAGE_KEY = 'right_panel_tabs';

type StoredState = {
  tabs: PanelTab[];
  activeId: string | null;
};

/** Read persisted right-panel tabs (for modules outside PanelTabsProvider). */
export function readPanelTabsState(): StoredState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

/** Active web tab id, if the focused right-panel tab is a web panel. */
export function getActiveWebTabId(): string | null {
  const state = readPanelTabsState();
  if (!state?.activeId) return null;
  const tab = state.tabs.find((t) => t.id === state.activeId);
  return tab?.kind === ('web' as PanelKind) ? tab.id : null;
}
