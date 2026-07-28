import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CustomizeTab, SettingsTab, WorkspaceLocation, WorkspaceView } from '@/lib/workspace-navigation';
import { dispatchOverlayDismiss } from '@/lib/overlay-dismiss';

export type { CustomizeTab, SettingsTab, WorkspaceView };

/** Identity + display label of the 项目首页 the workspace is showing.
 * The name is a snapshot for headers/nav labels; live data comes from
 * `useProjects()` by id. */
export type ProjectPageTarget = { id: string; name?: string };

type WorkspacePanelContextValue = {
  view: WorkspaceView;
  customizeTab: CustomizeTab;
  settingsTab: SettingsTab;
  projectPage: ProjectPageTarget | null;
  openCustomize: (tab?: CustomizeTab) => void;
  openAutomate: () => void;
  openAppSettings: () => void;
  openProject: (projectId: string, projectName?: string) => void;
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
  const [projectPage, setProjectPage] = useState<ProjectPageTarget | null>(null);

  useEffect(() => {
    dispatchOverlayDismiss('workspace-view');
  }, [view]);

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

  const openProject = useCallback((projectId: string, projectName?: string) => {
    setProjectPage({ id: projectId, name: projectName });
    setView('project');
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
      case 'project':
        setProjectPage({ id: loc.projectId, name: loc.projectName });
        setView('project');
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
      projectPage,
      openCustomize,
      openAutomate,
      openAppSettings,
      openProject,
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
      projectPage,
      openCustomize,
      openAutomate,
      openAppSettings,
      openProject,
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
