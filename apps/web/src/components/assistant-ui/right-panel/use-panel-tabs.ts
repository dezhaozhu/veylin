import { useAuiState } from '@assistant-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { closeWebView, hideWebView, isTauri } from '@/lib/tauri-web-view';
import {
  emptyPanelTabsState,
  findDocTab,
  loadThreadPanelTabs,
  migrateThreadPanelTabs,
  saveThreadPanelTabs,
  setLivePanelThread,
  type PanelTabsStoredState,
} from '@/lib/panel-tabs-storage';
import { isPanelTabsRemoteUpgrade } from '@/lib/panel-tabs-remote-upgrade';
import type { OpenGridFilter } from '@/lib/correction-bridge';
import { createNextThreadSheet, fetchThreadSheets } from '@/lib/table-sheets';
import { decideTablePanelSheet } from '@/lib/open-table-panel';
import { getPanelKindDef } from './panel-registry';
import type { PanelKind, PanelTab } from './panel-types';

function createTab(
  kind: PanelKind,
  opts?: { sheetId?: string; title?: string },
): PanelTab {
  const def = getPanelKindDef(kind);
  const state = def?.createState ? { ...def.createState() } : undefined;
  if (state && opts?.sheetId) {
    state.sheetId = opts.sheetId;
  }
  return {
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    kind,
    title: opts?.title?.trim() || def?.defaultTitle || kind,
    ...(state ? { state } : {}),
  };
}

/** Only web may have multiple tabs; table/rag/workflow are singletons. */
const SINGLETON_PANEL_KINDS = new Set<PanelKind>(['table', 'rag', 'workflow']);

function closeWebTabs(tabs: PanelTab[]): void {
  if (!isTauri()) return;
  for (const tab of tabs) {
    if (tab.kind === 'web') {
      void closeWebView(tab.id);
    }
  }
  void hideWebView(undefined, { force: true });
}

/** A schedule-grid drill waiting for the grid to position itself. `at` makes
 * each drill distinct so a repeat of the same filter still re-notifies (cf.
 * ragFocus.at). Consumed by TableGrid once its rows are on screen. */
export interface PendingScheduleFilter {
  filter: OpenGridFilter;
  at: number;
}

export interface PanelTabsApi {
  tabs: PanelTab[];
  activeId: string | null;
  activeTab: PanelTab | null;
  open: (kind: PanelKind) => void | Promise<void>;
  close: (id: string) => void;
  activate: (id: string) => void;
  updateState: (id: string, patch: Record<string, unknown>) => void;
  /** Focus a web tab and show it in the docked browser (for @ context). */
  focusWebTab: (id: string) => Promise<void>;
  /** Open/focus the knowledge panel and highlight a citation excerpt. */
  focusRagCitation: (focus: { refIndex?: number; chunkId?: string }) => void;
  /** Open/focus the schedule grid AND position it to a drill filter (排产即导航).
   * Opens the 'table' panel exactly like open('table'), then stashes the filter
   * for the grid to apply client-side once its rows are loaded. */
  focusScheduleFilter: (filter: OpenGridFilter) => void | Promise<void>;
  /**
   * 在右侧打开一份项目文件(只读)。同名文件**复用已开的那个 tab** —— 连点三次
   * 开出三个一模一样的 tab,是把"我已经打开它了"这件事讲成了三份。
   */
  openDocument: (doc: { projectId: string; name: string }) => void;
  /** The pending schedule-grid drill (null when none), read by TableGrid. */
  scheduleFilter: PendingScheduleFilter | null;
  /** Drop the pending drill once TableGrid has consumed it. */
  clearScheduleFilter: () => void;
}

/** Right-panel tab store. Use via PanelTabsProvider / usePanelTabs(). */
export function usePanelTabsState(): PanelTabsApi {
  const localId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const threadId = remoteId ?? localId ?? null;

  const [state, setState] = useState<PanelTabsStoredState>(() =>
    loadThreadPanelTabs(threadId),
  );
  // Pending schedule-grid drill (排产即导航). The grid is a workspace-wide
  // singleton bootstrapped once on mount, so a drill that arrives while it's
  // already open can't re-fetch to position it — it stashes here and TableGrid
  // applies it client-side once rows are on screen.
  const [scheduleFilter, setScheduleFilter] = useState<PendingScheduleFilter | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const threadIdRef = useRef(threadId);
  const localIdRef = useRef(localId);

  const commit = useCallback((next: PanelTabsStoredState) => {
    stateRef.current = next;
    setState(next);
    const tid = threadIdRef.current;
    saveThreadPanelTabs(tid, next);
    setLivePanelThread(tid, next);
  }, []);

  // Bind workspace to the current thread; migrate local→remote; clean native webviews.
  useEffect(() => {
    const prevThreadId = threadIdRef.current;
    const prevLocalId = localIdRef.current;
    const prevState = stateRef.current;

    // Same list-item gained a server remoteId (first message / initialize).
    // Must NOT fire when switching to a different conversation that already has a remoteId.
    const isRemoteUpgrade = isPanelTabsRemoteUpgrade({
      remoteId,
      localId,
      prevLocalId,
      prevThreadId,
      threadId,
    });

    localIdRef.current = localId;

    if (prevThreadId === threadId) {
      // Same key — keep live pointer fresh (e.g. first mount).
      setLivePanelThread(threadId, stateRef.current);
      return;
    }

    // Persist outgoing bucket (in case of in-flight edits).
    if (prevThreadId) {
      saveThreadPanelTabs(prevThreadId, prevState);
    }

    if (isRemoteUpgrade && prevThreadId && threadId) {
      migrateThreadPanelTabs(prevThreadId, threadId);
      threadIdRef.current = threadId;
      // Keep in-memory tabs (already shown); persist under the new remote id.
      saveThreadPanelTabs(threadId, prevState);
      setLivePanelThread(threadId, prevState);
      setState(prevState);
      return;
    }

    // Switching to a different conversation — tear down previous webviews.
    closeWebTabs(prevState.tabs);

    const next = loadThreadPanelTabs(threadId);
    threadIdRef.current = threadId;
    stateRef.current = next;
    setState(next);
    setLivePanelThread(threadId, next);
  }, [threadId, localId, remoteId]);

  // Keep live pointer synced on unmount clear.
  useEffect(() => {
    setLivePanelThread(threadId, state);
    return () => {
      setLivePanelThread(null, emptyPanelTabsState());
    };
    // Only clear on provider unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  const open = useCallback(
    async (kind: PanelKind) => {
      // Singleton kinds: activate existing instead of creating another tab.
      // Must run before table sheet creation to avoid orphan sheets.
      if (SINGLETON_PANEL_KINDS.has(kind)) {
        const existing = stateRef.current.tabs.find((t) => t.kind === kind);
        if (existing) {
          commit({ tabs: stateRef.current.tabs, activeId: existing.id });
          return;
        }
      }

      // 打开表格面板 ≠ 新建一张表。
      //
      // 从前这里无条件 createNextThreadSheet,于是**点一次面板就多一张空 Sheet**;
      // 表是按项目存的,换条对话再点一下,项目里又多一张 —— 用户看到的是
      // Sheet 1…Sheet 6 一路堆上去,没人知道那些是谁建的(实测)。
      // 已经有表就打开第一张;一张都没有才建(空面板没有可看的东西)。
      // 建表这件事仍然只发生在用户动作上,不在 TableGrid mount 里 —— 那会和
      // React Strict Mode 的双次调用打架。
      if (kind === 'table') {
        const tid = threadIdRef.current?.trim();
        if (!tid) return;
        try {
          const decided = decideTablePanelSheet(await fetchThreadSheets(tid));
          const sheetId =
            decided.kind === 'open' ? decided.sheetId : (await createNextThreadSheet(tid)).id;
          const tab = createTab(kind, { sheetId });
          commit({ tabs: [...stateRef.current.tabs, tab], activeId: tab.id });
        } catch {
          // Leave workspace unchanged when create fails.
        }
        return;
      }
      const tab = createTab(kind);
      commit({ tabs: [...stateRef.current.tabs, tab], activeId: tab.id });
    },
    [commit],
  );

  const close = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const closing = current.tabs.find((t) => t.id === id);
      if (closing?.kind === 'web' && isTauri()) {
        void closeWebView(id);
      }
      const idx = current.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const tabs = current.tabs.filter((t) => t.id !== id);
      let activeId = current.activeId;
      if (activeId === id) {
        const fallback = tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null;
        activeId = fallback?.id ?? null;
      }
      commit({ tabs, activeId });
    },
    [commit],
  );

  const activate = useCallback(
    (id: string) => {
      const current = stateRef.current;
      if (id === current.activeId) return;
      if (!current.tabs.some((t) => t.id === id)) return;
      commit({ tabs: current.tabs, activeId: id });
    },
    [commit],
  );

  const updateState = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const current = stateRef.current;
      const tabs = current.tabs.map((t) => {
        if (t.id !== id) return t;
        const next: PanelTab = {
          ...t,
          state: { ...t.state, ...patch },
        };
        // Web / table tabs keep the kind label; page/sheet names live in tab.state.
        if (
          t.kind !== 'web' &&
          t.kind !== 'table' &&
          typeof patch.title === 'string' &&
          patch.title.trim()
        ) {
          next.title = patch.title.trim();
        }
        return next;
      });
      commit({ tabs, activeId: current.activeId });
    },
    [commit],
  );

  const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? null;

  const focusWebTab = useCallback(
    async (id: string) => {
      const current = stateRef.current;
      const tab = current.tabs.find((t) => t.id === id);
      if (!tab || tab.kind !== 'web') return;
      if (id !== current.activeId) {
        commit({ tabs: current.tabs, activeId: id });
      }
    },
    [commit],
  );

  const focusRagCitation = useCallback(
    (focus: { refIndex?: number; chunkId?: string }) => {
      const current = stateRef.current;
      const existing = current.tabs.find((t) => t.kind === 'rag');
      const ragFocus = { ...focus, at: Date.now() };
      if (existing) {
        const tabs = current.tabs.map((t) =>
          t.id === existing.id
            ? { ...t, state: { ...t.state, ragFocus, ragSubTab: 'citations' } }
            : t,
        );
        commit({ tabs, activeId: existing.id });
        return;
      }
      const tab = createTab('rag');
      tab.state = { ragFocus, ragSubTab: 'citations' };
      commit({ tabs: [...current.tabs, tab], activeId: tab.id });
    },
    [commit],
  );

  const focusScheduleFilter = useCallback(
    (filter: OpenGridFilter) => {
      // Open/activate the table panel through the SAME singleton + sheet-create
      // path as the (+) action — no duplicate logic here.
      void open('table');
      // Stash for TableGrid to apply once its rows are live; `at` distinguishes
      // repeat drills so an identical filter still re-notifies.
      setScheduleFilter({ filter, at: Date.now() });
    },
    [open],
  );

  const openDocument = useCallback(
    (doc: { projectId: string; name: string }) => {
      const current = stateRef.current;
      const existing = findDocTab(current.tabs, doc);
      if (existing) {
        commit({ ...current, activeId: existing.id });
        return;
      }
      const tab = createTab('doc');
      tab.state = { ...doc };
      // tab 上显示文件名而不是"文档" —— 开着两份文件时,两个都叫"文档"等于没标。
      tab.title = doc.name;
      commit({ tabs: [...current.tabs, tab], activeId: tab.id });
    },
    [commit],
  );

  const clearScheduleFilter = useCallback(() => setScheduleFilter(null), []);

  return {
    openDocument,
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab,
    open,
    close,
    activate,
    updateState,
    focusWebTab,
    focusRagCitation,
    focusScheduleFilter,
    scheduleFilter,
    clearScheduleFilter,
  };
}
