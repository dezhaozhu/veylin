import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type WorkspaceView = 'chat' | 'customize' | 'automate' | 'settings';
export type CustomizeTab = 'skills' | 'rules' | 'mcp';

type WorkspacePanelContextValue = {
  view: WorkspaceView;
  customizeTab: CustomizeTab;
  openCustomize: (tab?: CustomizeTab) => void;
  openAutomate: () => void;
  openAppSettings: () => void;
  closeWorkspace: () => void;
  setCustomizeTab: (tab: CustomizeTab) => void;
  /** Opens Customize MCP (composer shortcut). */
  openSettings: (tab?: CustomizeTab | 'mcp' | 'skills' | 'rules') => void;
};

const WorkspacePanelContext = createContext<WorkspacePanelContextValue | null>(null);

export function SettingsPanelProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<WorkspaceView>('chat');
  const [customizeTab, setCustomizeTab] = useState<CustomizeTab>('skills');

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
      openCustomize,
      openAutomate,
      openAppSettings,
      closeWorkspace,
      setCustomizeTab,
      openSettings,
    }),
    [view, customizeTab, openCustomize, openAutomate, openAppSettings, closeWorkspace, openSettings],
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
