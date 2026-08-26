import { useCallback, useEffect } from 'react';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import { splitPanelRender } from '@/lib/panel-keep-alive';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useRightSidebar } from '@/components/ui/sidebar';
import { PanelEmptyState } from './panel-empty-state';
import { PanelTabBar } from './panel-tab-bar';
import { getPanelKindDef } from './panel-registry';
import { usePanelTabs } from './panel-tabs-context';
import type { PanelTab } from './panel-types';

/** Unified right-panel container: tab strip + content area hosting any panel kind. */
export function RightPanel() {
  const { view } = useSettingsPanel();
  const { open: rightOpen } = useRightSidebar();
  const { tabs, activeId, activeTab, open, close, activate, updateState } = usePanelTabs();

  const handleUpdateState = useCallback(
    (tabId: string, patch: Record<string, unknown>) => {
      updateState(tabId, patch);
    },
    [updateState],
  );

  const { keepAlive, activeEphemeral } = splitPanelRender(tabs, activeId);
  const ephemeralDef = activeEphemeral ? getPanelKindDef(activeEphemeral.kind) : undefined;
  const EphemeralContent = ephemeralDef?.Component;
  const showEmpty = !activeTab;

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
      {/* data-panel-kind:哪种面板正开着。e2e 靠它确认"面板开了",而不是靠
          面板内部某个只在有数据时才渲染的元素(表格空作用域走的是空状态早退,
          页签栏根本不渲染 —— 断言会冤枉面板)。 */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        {...(activeTab ? { 'data-panel-kind': activeTab.kind } : {})}
      >
        {keepAlive.map((tab) => (
          <KeepAliveSlot
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            updateState={handleUpdateState}
          />
        ))}
        {activeEphemeral && EphemeralContent ? (
          <EphemeralContent
            key={activeEphemeral.id}
            tab={activeEphemeral}
            updateState={(patch) => handleUpdateState(activeEphemeral.id, patch)}
          />
        ) : null}
        {showEmpty ? <PanelEmptyState onOpen={open} /> : null}
      </div>
    </div>
  );
}

function KeepAliveSlot({
  tab,
  active,
  updateState,
}: {
  tab: PanelTab;
  active: boolean;
  updateState: (tabId: string, patch: Record<string, unknown>) => void;
}) {
  const def = getPanelKindDef(tab.kind);
  if (!def) return null;
  const Content = def.Component;
  return (
    <div
      className={
        active
          ? 'relative h-full min-h-0'
          : 'pointer-events-none invisible absolute inset-0'
      }
      aria-hidden={!active}
    >
      <Content tab={tab} updateState={(patch) => updateState(tab.id, patch)} />
    </div>
  );
}
