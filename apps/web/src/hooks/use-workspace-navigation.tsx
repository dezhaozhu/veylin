import { useAui, useAuiState } from '@assistant-ui/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useSettingsPanel } from '@/hooks/settings/use-settings-panel';
import {
  buildWorkspaceLocation,
  loadNavState,
  locationKey,
  pushLocation,
  reconcileNav,
  saveNavState,
  type NavState,
  type WorkspaceLocation,
} from '@/lib/workspace-navigation';

type WorkspaceNavigationContextValue = {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
};

const WorkspaceNavigationContext = createContext<WorkspaceNavigationContextValue | null>(null);

export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const { applyWorkspaceLocation } = useSettingsPanel();
  const [nav, setNav] = useState<NavState>(() => loadNavState());
  const navRef = useRef(nav);
  navRef.current = nav;
  const suppressRecordRef = useRef(false);
  const pendingTargetKeyRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const threadIdRef = useRef<string | undefined>(undefined);
  const switchToThreadRef = useRef<(threadId: string) => Promise<void>>(async () => {});

  const registerThreadSwitcher = useCallback(
    (switcher: (threadId: string) => Promise<void>) => {
      switchToThreadRef.current = switcher;
    },
    [],
  );

  const activateEntry = useCallback(
    async (target: WorkspaceLocation, targetIndex: number) => {
      const targetKey = locationKey(target);
      suppressRecordRef.current = true;
      pendingTargetKeyRef.current = targetKey;

      try {
        if (target.view === 'chat' && target.threadId) {
          if (threadIdRef.current !== target.threadId) {
            await switchToThreadRef.current(target.threadId);
          }
        }
        applyWorkspaceLocation(target);
        setNav((prev) => ({ ...prev, index: targetIndex }));
      } catch {
        pendingTargetKeyRef.current = null;
        suppressRecordRef.current = false;
      }
    },
    [applyWorkspaceLocation],
  );

  const goBack = useCallback(() => {
    const prev = navRef.current;
    if (prev.index <= 0) return;
    const targetIndex = prev.index - 1;
    const target = prev.entries[targetIndex];
    if (!target) return;
    void activateEntry(target, targetIndex);
  }, [activateEntry]);

  const goForward = useCallback(() => {
    const prev = navRef.current;
    if (prev.index < 0 || prev.index >= prev.entries.length - 1) return;
    const targetIndex = prev.index + 1;
    const target = prev.entries[targetIndex];
    if (!target) return;
    void activateEntry(target, targetIndex);
  }, [activateEntry]);

  const value = useMemo(
    () => ({
      canGoBack: nav.index > 0,
      canGoForward: nav.index >= 0 && nav.index < nav.entries.length - 1,
      goBack,
      goForward,
    }),
    [goBack, goForward, nav.entries.length, nav.index],
  );

  useEffect(() => {
    saveNavState(nav);
  }, [nav]);

  return (
    <WorkspaceNavigationContext.Provider value={value}>
      <WorkspaceNavigationRecorder
        setNav={setNav}
        suppressRecordRef={suppressRecordRef}
        pendingTargetKeyRef={pendingTargetKeyRef}
        hydratedRef={hydratedRef}
        threadIdRef={threadIdRef}
        registerThreadSwitcher={registerThreadSwitcher}
      />
      {children}
    </WorkspaceNavigationContext.Provider>
  );
}

function WorkspaceNavigationRecorder({
  setNav,
  suppressRecordRef,
  pendingTargetKeyRef,
  hydratedRef,
  threadIdRef,
  registerThreadSwitcher,
}: {
  setNav: Dispatch<SetStateAction<NavState>>;
  suppressRecordRef: MutableRefObject<boolean>;
  pendingTargetKeyRef: MutableRefObject<string | null>;
  hydratedRef: MutableRefObject<boolean>;
  threadIdRef: MutableRefObject<string | undefined>;
  registerThreadSwitcher: (switcher: (threadId: string) => Promise<void>) => void;
}) {
  const { view, customizeTab, settingsTab } = useSettingsPanel();
  const aui = useAui();
  const threadId = useAuiState((s) => s.threadListItem.id);
  const threadTitle = useAuiState((s) => s.threadListItem.title);

  threadIdRef.current = threadId;

  useEffect(() => {
    registerThreadSwitcher(async (id) => {
      await aui.threads().switchToThread(id);
    });
  }, [aui, registerThreadSwitcher]);

  const locationSnapshot = buildWorkspaceLocation({
    view,
    customizeTab,
    settingsTab,
    threadId,
    threadTitle,
  });
  const snapshotKey = locationSnapshot ? locationKey(locationSnapshot) : null;

  useEffect(() => {
    const loc = buildWorkspaceLocation({
      view,
      customizeTab,
      settingsTab,
      threadId,
      threadTitle,
    });
    if (!loc || !snapshotKey) return;

    if (pendingTargetKeyRef.current) {
      if (snapshotKey === pendingTargetKeyRef.current) {
        pendingTargetKeyRef.current = null;
        suppressRecordRef.current = false;
      } else {
        return;
      }
    }

    if (suppressRecordRef.current) {
      suppressRecordRef.current = false;
      return;
    }

    setNav((prev) => {
      const next = hydratedRef.current ? pushLocation(prev, loc) : reconcileNav(prev, loc);
      hydratedRef.current = true;
      return next;
    });
  }, [
    view,
    customizeTab,
    settingsTab,
    threadId,
    snapshotKey,
    setNav,
    suppressRecordRef,
    pendingTargetKeyRef,
    hydratedRef,
  ]);

  return null;
}

export function useWorkspaceNavigation(): WorkspaceNavigationContextValue {
  const ctx = useContext(WorkspaceNavigationContext);
  if (!ctx) {
    throw new Error('useWorkspaceNavigation must be used within WorkspaceNavigationProvider');
  }
  return ctx;
}
