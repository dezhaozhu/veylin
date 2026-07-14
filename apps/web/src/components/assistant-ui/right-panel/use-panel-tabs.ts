import { useAuiState } from '@assistant-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { closeWebView, hideWebView, isTauri } from '@/lib/tauri-web-view';
import {
  emptyPanelTabsState,
  loadThreadPanelTabs,
  migrateThreadPanelTabs,
  saveThreadPanelTabs,
  setLivePanelThread,
  type PanelTabsStoredState,
} from '@/lib/panel-tabs-storage';
import { isPanelTabsRemoteUpgrade } from '@/lib/panel-tabs-remote-upgrade';
import { createNextThreadSheet } from '@/lib/table-sheets';
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

      // Create the sheet at the user action (+), not on TableGrid mount —
      // mount-time create races with React Strict Mode double-invoke.
      if (kind === 'table') {
        const tid = threadIdRef.current?.trim();
        if (!tid) return;
        try {
          const sheet = await createNextThreadSheet(tid);
          const tab = createTab(kind, {
            sheetId: sheet.id,
          });
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

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab,
    open,
    close,
    activate,
    updateState,
    focusWebTab,
    focusRagCitation,
  };
}
