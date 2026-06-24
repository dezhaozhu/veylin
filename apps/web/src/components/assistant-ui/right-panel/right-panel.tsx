import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelTabBar } from './panel-tab-bar';
import { getPanelKindDef } from './panel-registry';
import { usePanelTabs } from './use-panel-tabs';

/** Unified right-panel container: tab strip + content area hosting any panel kind. */
export function RightPanel() {
  const { t } = useTranslation();
  const { tabs, activeId, activeTab, open, close, activate, updateState } = usePanelTabs();

  const handleUpdateState = useCallback(
    (patch: Record<string, unknown>) => {
      if (activeTab) updateState(activeTab.id, patch);
    },
    [activeTab, updateState],
  );

  const def = activeTab ? getPanelKindDef(activeTab.kind) : undefined;
  const Content = def?.Component;

  return (
    <div className="border-border flex h-full min-h-0 flex-col border-l">
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
