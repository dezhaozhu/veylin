import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useRightSidebar } from '@/components/ui/sidebar';
import { PanelTabBar } from './panel-tab-bar';
import { getPanelKindDef } from './panel-registry';
import { usePanelTabs } from './panel-tabs-context';

/** Unified right-panel container: tab strip + content area hosting any panel kind. */
export function RightPanel() {
  const { t } = useTranslation();
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
      void hideWebView();
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
          <Content tab={activeTab} updateState={handleUpdateState} />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-sm">
            {t('panels.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
