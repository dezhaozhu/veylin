import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hideWebView, isTauri } from '@/lib/tauri-web-view';
import { splitPanelRender } from '@/lib/panel-keep-alive';
import { clampSplitRatio, splitLayout, visibleTabIds } from '@/lib/panel-split';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import { useRightSidebar } from '@/components/ui/sidebar';
import { PanelEmptyState } from './panel-empty-state';
import { PanelTabBar } from './panel-tab-bar';
import { getPanelKindDef } from './panel-registry';
import { usePanelTabs } from './panel-tabs-context';
import type { PanelTab } from './panel-types';

/**
 * Unified right-panel container. 无分屏 = 一条页签栏 + 一块内容;分屏 = 上下两个
 * pane,各自一条页签栏、各自一个可见页,中间一条可拖的分隔线(模型见 panel-split.ts)。
 *
 * keep-alive(表格)不跟着 pane 走 React 树:30k 行的表格换个 pane 就重挂,等于
 * 每次移动都重灌一遍。它渲染进一个**身份永远不变的脱手 div**(portal 容器不变 ⇒
 * React 不重挂),再由 effect 把这个 div appendChild 到当前所属 pane 的 host 里
 * —— 换 pane 只是一次 DOM 移动。
 */
export function RightPanel() {
  const { view } = useSettingsPanel();
  const { open: rightOpen } = useRightSidebar();
  const {
    tabs,
    activeId,
    activeTab,
    split,
    open,
    close,
    activate,
    moveTabToPane,
    setSplitRatio,
    updateState,
  } = usePanelTabs();

  const handleUpdateState = useCallback(
    (tabId: string, patch: Record<string, unknown>) => {
      updateState(tabId, patch);
    },
    [updateState],
  );

  const layout = splitLayout(tabs, split);
  const hasSplit = Boolean(split);
  const topVisibleId = split ? split.topVisibleId : activeId;
  const bottomVisibleId = split?.bottomVisibleId ?? null;
  const top = splitPanelRender(layout.top, topVisibleId);
  const bottom = splitPanelRender(layout.bottom, bottomVisibleId);
  const showEmpty = !activeTab;

  // 拖动中比例走本地 state,pointerup 才落盘 —— 拖一次不写几十次 localStorage。
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const ratio = dragRatio ?? split?.ratio ?? 0.5;
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [topHost, setTopHost] = useState<HTMLDivElement | null>(null);
  const [bottomHost, setBottomHost] = useState<HTMLDivElement | null>(null);

  // 每个 keep-alive 页签一个身份稳定的脱手容器。display:contents —— 容器自己
  // 不产生布局盒,里面 KeepAliveSlot 的 h-full/absolute 直接对着 pane host 算。
  const keepAliveContainers = useRef(new Map<string, HTMLDivElement>());
  const containerFor = (tabId: string): HTMLDivElement => {
    let el = keepAliveContainers.current.get(tabId);
    if (!el) {
      el = document.createElement('div');
      el.style.display = 'contents';
      keepAliveContainers.current.set(tabId, el);
    }
    return el;
  };

  const keepAliveTabs = [...top.keepAlive, ...bottom.keepAlive];
  const bottomIdSet = new Set(split?.bottomIds ?? []);

  // 把脱手容器挂到当前所属 pane 的 host;页签关了就把容器摘掉。
  // 依赖故意从宽(每次渲染跑):appendChild 到已是父级的节点是空操作,便宜。
  useEffect(() => {
    for (const tab of keepAliveTabs) {
      const el = containerFor(tab.id);
      const host = bottomIdSet.has(tab.id) ? bottomHost : topHost;
      if (host && el.parentElement !== host) host.appendChild(el);
    }
    for (const [id, el] of keepAliveContainers.current) {
      if (!tabs.some((t) => t.id === id)) {
        el.remove();
        keepAliveContainers.current.delete(id);
      }
    }
  });

  // 分屏后「active 页签是不是 web」不再等于「有没有 web 可见」—— web 可以在
  // 非 active 的那个 pane 里可见。判定改看可见集。
  const visibleIds = visibleTabIds({ tabs, activeId, split });
  const webVisible = visibleIds.some(
    (id) => tabs.find((t) => t.id === id)?.kind === 'web',
  );
  useEffect(() => {
    if (!isTauri()) return;
    if (!rightOpen || view !== 'chat' || !webVisible) {
      void hideWebView(undefined, { force: true });
    }
  }, [rightOpen, view, webVisible]);

  const onSplitterPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) return;
      event.preventDefault();
      const handle = event.currentTarget;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // 拿不到 capture(指针已释放/合成事件)也能拖 —— move/up 监听都在 window 上,
        // capture 只是防止指针滑进原生 webview 时丢事件的加固。
      }
      const rect = root.getBoundingClientRect();
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      let latest: number | null = null;

      const onPointerMove = (move: PointerEvent) => {
        if (rect.height < 1) return;
        latest = clampSplitRatio((move.clientY - rect.top) / rect.height);
        setDragRatio(latest);
      };
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        handle.removeEventListener('lostpointercapture', end);
        if (latest != null) setSplitRatio(latest);
        setDragRatio(null);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      handle.addEventListener('lostpointercapture', end);
    },
    [setSplitRatio],
  );

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <Pane
        variant="primary"
        tabs={layout.top}
        visibleId={topVisibleId}
        activeEphemeral={top.activeEphemeral}
        canMoveTabs={layout.top.length > 1}
        onActivate={activate}
        onClose={close}
        onOpen={open}
        onMoveTab={moveTabToPane}
        updateState={handleUpdateState}
        hostRef={setTopHost}
        style={hasSplit ? { flexBasis: `${ratio * 100}%`, flexGrow: 0 } : undefined}
        className={hasSplit ? 'min-h-0' : 'min-h-0 flex-1'}
      >
        {showEmpty ? <PanelEmptyState onOpen={open} /> : null}
      </Pane>
      {hasSplit ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            className="bg-border hover:bg-primary/40 relative z-10 h-px shrink-0 cursor-row-resize transition-colors after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']"
            onPointerDown={onSplitterPointerDown}
          />
          <Pane
            variant="secondary"
            tabs={layout.bottom}
            visibleId={bottomVisibleId}
            activeEphemeral={bottom.activeEphemeral}
            canMoveTabs
            onActivate={activate}
            onClose={close}
            onOpen={open}
            onMoveTab={moveTabToPane}
            updateState={handleUpdateState}
            hostRef={setBottomHost}
            className="min-h-0 flex-1"
          />
        </>
      ) : null}
      {keepAliveTabs.map((tab) =>
        createPortal(
          <KeepAliveSlot
            key={tab.id}
            tab={tab}
            active={visibleIds.includes(tab.id)}
            updateState={handleUpdateState}
          />,
          containerFor(tab.id),
          tab.id,
        ),
      )}
    </div>
  );
}

function Pane({
  variant,
  tabs,
  visibleId,
  activeEphemeral,
  canMoveTabs,
  onActivate,
  onClose,
  onOpen,
  onMoveTab,
  updateState,
  hostRef,
  style,
  className,
  children,
}: {
  variant: 'primary' | 'secondary';
  tabs: PanelTab[];
  visibleId: string | null;
  activeEphemeral: PanelTab | null;
  canMoveTabs: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: (kind: PanelTab['kind']) => void | Promise<void>;
  onMoveTab: (id: string, pane: 'top' | 'bottom') => void;
  updateState: (tabId: string, patch: Record<string, unknown>) => void;
  hostRef: (el: HTMLDivElement | null) => void;
  style?: React.CSSProperties;
  className?: string;
  children?: React.ReactNode;
}) {
  const visibleTab = tabs.find((t) => t.id === visibleId) ?? null;
  const ephemeralDef = activeEphemeral ? getPanelKindDef(activeEphemeral.kind) : undefined;
  const EphemeralContent = ephemeralDef?.Component;
  return (
    <div className={`flex flex-col ${className ?? ''}`} style={style}>
      <PanelTabBar
        variant={variant}
        tabs={tabs}
        activeId={visibleId}
        canMoveTabs={canMoveTabs}
        onActivate={onActivate}
        onClose={onClose}
        onOpen={onOpen}
        onMoveTab={onMoveTab}
      />
      {/* data-panel-kind:这个 pane 此刻开着哪种面板。e2e 靠它确认"面板开了",
          而不是靠面板内部某个只在有数据时才渲染的元素。 */}
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        {...(visibleTab ? { 'data-panel-kind': visibleTab.kind } : {})}
      >
        {activeEphemeral && EphemeralContent ? (
          <EphemeralContent
            key={activeEphemeral.id}
            tab={activeEphemeral}
            updateState={(patch) => updateState(activeEphemeral.id, patch)}
          />
        ) : null}
        {children}
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
