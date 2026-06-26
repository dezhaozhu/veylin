import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CustomizeTab, SettingsTab, WorkspaceLocation, WorkspaceView } from '@/lib/workspace-navigation';

export type { CustomizeTab, SettingsTab, WorkspaceView };

type WorkspacePanelContextValue = {
  view: WorkspaceView;
  customizeTab: CustomizeTab;
  settingsTab: SettingsTab;
  openCustomize: (tab?: CustomizeTab) => void;
  openAutomate: () => void;
  openAppSettings: () => void;
  closeWorkspace: () => void;
  setCustomizeTab: (tab: CustomizeTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  applyWorkspaceLocation: (loc: WorkspaceLocation) => void;
  /** Opens Customize MCP (composer shortcut). */
  openSettings: (tab?: CustomizeTab | 'mcp' | 'skills' | 'rules') => void;
};

const WorkspacePanelContext = createContext<WorkspacePanelContextValue | null>(null);

export function SettingsPanelProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<WorkspaceView>('chat');
  const [customizeTab, setCustomizeTab] = useState<CustomizeTab>('rules');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');

  const openCustomize = useCallback((tab?: CustomizeTab) => {
    if (tab) setCustomizeTab(tab);
    setView('customize');
  }, []);

  const openAutomate = useCallback(() => {
    setView('automate');
  }, []);

  const openAppSettings = useCallback(() => {
    setView('settings');
  }, []);

  const closeWorkspace = useCallback(() => {
    setView('chat');
  }, []);

  const applyWorkspaceLocation = useCallback((loc: WorkspaceLocation) => {
    switch (loc.view) {
      case 'chat':
        setView('chat');
        break;
      case 'customize':
        setCustomizeTab(loc.tab);
        setView('customize');
        break;
      case 'automate':
        setView('automate');
        break;
      case 'settings':
        setSettingsTab(loc.tab);
        setView('settings');
        break;
    }
  }, []);

  const openSettings = useCallback(
    (tab?: CustomizeTab | 'mcp' | 'skills' | 'rules' | 'automations') => {
      if (tab === 'automations') {
        openAutomate();
        return;
      }
      if (tab) openCustomize(tab as CustomizeTab);
      else openCustomize();
    },
    [openCustomize, openAutomate],
  );

  const value = useMemo(
    () => ({
      view,
      customizeTab,
      settingsTab,
      openCustomize,
      openAutomate,
      openAppSettings,
      closeWorkspace,
      setCustomizeTab,
      setSettingsTab,
      applyWorkspaceLocation,
      openSettings,
    }),
    [
      view,
      customizeTab,
      settingsTab,
      openCustomize,
      openAutomate,
      openAppSettings,
      closeWorkspace,
      applyWorkspaceLocation,
      openSettings,
    ],
  );

  return (
    <WorkspacePanelContext.Provider value={value}>{children}</WorkspacePanelContext.Provider>
  );
}

export function useSettingsPanel(): WorkspacePanelContextValue {
  const ctx = useContext(WorkspacePanelContext);
  if (!ctx) throw new Error('useSettingsPanel must be used within SettingsPanelProvider');
  return ctx;
}

export function useWorkspacePanel() {
  return useSettingsPanel();
}
