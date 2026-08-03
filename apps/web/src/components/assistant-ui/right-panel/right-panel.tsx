import { useCallback, useEffect } from 'react';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useRightSidebar } from '@/components/ui/sidebar';
import { PanelEmptyState } from './panel-empty-state';
import { PanelTabBar } from './panel-tab-bar';
import { getPanelKindDef } from './panel-registry';
import { usePanelTabs } from './panel-tabs-context';

/** Unified right-panel container: tab strip + content area hosting any panel kind. */
export function RightPanel() {
  const { view } = useSettingsPanel();
  const { open: rightOpen } = useRightSidebar();
  const { tabs, activeId, activeTab, open, close, activate, updateState } = usePanelTabs();

  const handleUpdateState = useCallback(
    (patch: Record<string, unknown>) => {
      if (activeTab) updateState(activeTab.id, patch);
    },
    [activeTab, updateState],
  );

  const def = activeTab ? getPanelKindDef(activeTab.kind) : undefined;
  const Content = def?.Component;

  useEffect(() => {
    if (!isTauri()) return;
    if (!rightOpen || view !== 'chat' || activeTab?.kind !== 'web') {
      void hideWebView(undefined, { force: true });
    }
  }, [rightOpen, view, activeTab?.kind, activeTab?.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTabBar
        tabs={tabs}
        activeId={activeId}
        onActivate={activate}
        onClose={close}
        onOpen={open}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab && Content ? (
          <Content
            key={activeTab.id}
            tab={activeTab}
            updateState={handleUpdateState}
          />
        ) : (
          <PanelEmptyState onOpen={open} />
        )}
      </div>
    </div>
  );
}
