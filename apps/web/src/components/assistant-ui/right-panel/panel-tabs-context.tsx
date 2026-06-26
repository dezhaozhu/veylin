import { createContext, useContext, type ReactNode } from 'react';
import { usePanelTabsState, type PanelTabsApi } from './use-panel-tabs';

const PanelTabsContext = createContext<PanelTabsApi | null>(null);

export function PanelTabsProvider({ children }: { children: ReactNode }) {
  const api = usePanelTabsState();
  return <PanelTabsContext.Provider value={api}>{children}</PanelTabsContext.Provider>;
}

export function usePanelTabs(): PanelTabsApi {
  const ctx = useContext(PanelTabsContext);
  if (!ctx) {
    throw new Error('usePanelTabs must be used within PanelTabsProvider');
  }
  return ctx;
}
