import { useAui, useAuiState } from '@assistant-ui/store';
import { useCallback, useEffect, useRef } from 'react';
import {
  getChatSettings,
  onChatSettingsChange,
  setChatSettings,
  type AttachedBrowserTab,
} from '@/lib/chat-settings';
import {
  fetchThreadPlanMode,
  inferPlanModeFromThreadMessages,
  readCachedThreadPlanMode,
  writeCachedThreadPlanMode,
} from '@/lib/plan-mode-sync';
import { fetchThreadTodos, clearThreadTodosSnapshot } from '@/lib/thread-todos-store';
import {
  fetchActivatedSkills,
  clearActivatedSkillsSnapshot,
} from '@/lib/activated-skills-store';
import {
  ackGoalContinueApi,
  ackLoopWakeApi,
  clearThreadGoalApi,
  fetchThreadGoal,
  fetchThreadLoop,
  onGoalLoopChange,
  readCachedGoal,
  readCachedLoop,
  setThreadGoalApi,
  setThreadLoopApi,
  stopThreadLoopApi,
} from '@/lib/goal-loop-sync';
import { requestSilentChatContinue } from '@/lib/silent-chat-continue';
import { requestChatStop } from '@/lib/chat-stop';
import { useState } from 'react';

function applyPlanModeForThread(threadId: string | undefined, on: boolean): void {
  if (threadId) writeCachedThreadPlanMode(threadId, on);
  if (getChatSettings().planMode !== on) {
    setChatSettings({ planMode: on });
  }
}

/** In-flight POSTs — GET must not clobber optimistic local plan mode. */
const planModeSyncPending = new Set<string>();

function postPlanMode(threadId: string | undefined, on: boolean): void {
  applyPlanModeForThread(threadId, on);
  if (!threadId) return;
  planModeSyncPending.add(threadId);
  void fetch('/api/plan-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, planMode: on }),
  })
    .catch(() => undefined)
    .finally(() => {
      planModeSyncPending.delete(threadId);
    });
}

function applyFetchedPlanMode(threadId: string, on: boolean): void {
  if (planModeSyncPending.has(threadId)) return;
  applyPlanModeForThread(threadId, on);
}

/**
 * Plan / Goal / Loop are mutually exclusive — enabling one clears the other two.
 */
function clearOtherComposerModes(
  keep: 'plan' | 'goal' | 'loop',
  threadId: string | undefined,
): void {
  if (keep !== 'plan') {
    postPlanMode(threadId, false);
  }
  if (keep !== 'goal') {
    setChatSettings({ pendingGoal: false });
    if (threadId) {
      void requestChatStop(threadId).catch(() => undefined);
      void clearThreadGoalApi(threadId);
    }
  }
  if (keep !== 'loop') {
    setChatSettings({ pendingLoop: false });
    if (threadId) {
      void stopThreadLoopApi(threadId);
    }
  }
}

/** Mount once per thread view — keeps composer plan UI in sync with agent tool calls. */
export function usePlanModeBridge(): void {
  // Only fetch for persisted threads. Local __LOCALID_* must not hit GET /state
  // (that would ensureThreadState and create an empty「新对话」on refresh).
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    if (!threadId) {
      clearThreadTodosSnapshot();
      clearActivatedSkillsSnapshot();
      return;
    }
    const cached = readCachedThreadPlanMode(threadId);
    if (cached != null) {
      applyPlanModeForThread(threadId, cached);
    }
    void fetchThreadPlanMode(threadId).then((on) => {
      applyFetchedPlanMode(threadId, on);
    });
    void fetchThreadTodos(threadId);
    void fetchActivatedSkills(threadId);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const inferred = inferPlanModeFromThreadMessages(messages);
    if (inferred == null) return;
    applyPlanModeForThread(threadId, inferred);
  }, [threadId, messages]);

  useEffect(() => {
    if (!threadId) return;
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = isRunning;

    if (wasRunning && !isRunning) {
      void fetchThreadPlanMode(threadId).then((on) => {
        applyFetchedPlanMode(threadId, on);
      });
      void fetchThreadTodos(threadId);
      void fetchActivatedSkills(threadId);
    }

    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void fetchThreadPlanMode(threadId).then((on) => {
        applyFetchedPlanMode(threadId, on);
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [threadId, isRunning]);
}

export function useChatSettingsState() {
  const [settings, setLocal] = useState(() => getChatSettings());
  useEffect(() => onChatSettingsChange(setLocal), []);
  return settings;
}

export function usePlanMode() {
  const threadId = useAuiState(
    (s) =>
      s.threadListItem.remoteId ??
      s.threadListItem.externalId ??
      s.threadListItem.id,
  );
  const planMode = useChatSettingsState().planMode;

  const setPlanMode = useCallback(
    (on: boolean) => {
      if (on) clearOtherComposerModes('plan', threadId);
      postPlanMode(threadId, on);
    },
    [threadId],
  );

  const togglePlanMode = useCallback(() => setPlanMode(!planMode), [planMode, setPlanMode]);

  return { planMode, setPlanMode, togglePlanMode };
}

export function useGoalLoopState() {
  const threadId = useAuiState(
    (s) =>
      s.threadListItem.remoteId ??
      s.threadListItem.externalId ??
      s.threadListItem.id,
  );
  const [, bump] = useState(0);
  useEffect(() => onGoalLoopChange(() => bump((n) => n + 1)), []);
  const settings = useChatSettingsState();
  const pendingGoal = settings.pendingGoal;
  const pendingLoop = settings.pendingLoop;

  const goal =
    threadId != null ? (readCachedGoal(threadId) ?? null) : null;
  const loop =
    threadId != null ? (readCachedLoop(threadId) ?? null) : null;

  const setPendingGoal = useCallback(
    (on: boolean) => {
      if (on) {
        clearOtherComposerModes('goal', threadId);
        setChatSettings({ pendingGoal: true, pendingLoop: false });
        return;
      }
      setChatSettings({ pendingGoal: false });
    },
    [threadId],
  );

  const setPendingLoop = useCallback(
    (on: boolean) => {
      if (on) {
        clearOtherComposerModes('loop', threadId);
        setChatSettings({ pendingLoop: true, pendingGoal: false });
        return;
      }
      setChatSettings({ pendingLoop: false });
    },
    [threadId],
  );

  const clearGoal = useCallback(async () => {
    setChatSettings({ pendingGoal: false });
    if (!threadId) return;
    // Stop in-flight turn so onFinish cannot resurrect the goal.
    void requestChatStop(threadId).catch(() => undefined);
    await clearThreadGoalApi(threadId);
  }, [threadId]);

  const stopLoop = useCallback(async () => {
    setChatSettings({ pendingLoop: false });
    if (!threadId) return;
    await stopThreadLoopApi(threadId);
  }, [threadId]);

  const setGoal = useCallback(
    async (condition: string) => {
      if (!threadId) return { ok: false as const, error: 'no_thread' };
      clearOtherComposerModes('goal', threadId);
      return setThreadGoalApi(threadId, condition);
    },
    [threadId],
  );

  const setLoop = useCallback(
    async (
      prompt: string,
      opts?: { intervalSeconds?: number; interval?: string; mode?: 'fixed' | 'dynamic' },
    ) => {
      if (!threadId) return { ok: false as const, error: 'no_thread' };
      clearOtherComposerModes('loop', threadId);
      return setThreadLoopApi(threadId, prompt, opts);
    },
    [threadId],
  );

  const toggleGoal = useCallback(() => {
    if (goal?.status === 'active' || pendingGoal) {
      void clearGoal();
      return;
    }
    setPendingGoal(true);
  }, [goal?.status, pendingGoal, clearGoal, setPendingGoal]);

  const toggleLoop = useCallback(() => {
    if (loop?.status === 'active' || pendingLoop) {
      void stopLoop();
      return;
    }
    setPendingLoop(true);
  }, [loop?.status, pendingLoop, stopLoop, setPendingLoop]);

  return {
    threadId,
    goal,
    loop,
    goalActive: goal?.status === 'active',
    loopActive: loop?.status === 'active',
    pendingGoal,
    pendingLoop,
    setPendingGoal,
    setPendingLoop,
    toggleGoal,
    toggleLoop,
    setGoal,
    clearGoal,
    setLoop,
    stopLoop,
  };
}

export function useGoalMode() {
  const { goalActive, pendingGoal, toggleGoal, clearGoal, setPendingGoal } = useGoalLoopState();
  return {
    goalMode: pendingGoal || goalActive,
    pendingGoal,
    goalActive,
    toggleGoal,
    clearGoal,
    setPendingGoal,
  };
}

/** Sync goal/loop from API; auto-continue goal and fire loop wakes when idle. */
export function useGoalLoopBridge(): void {
  const aui = useAui();
  const threadId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunningRef = useRef(false);
  const continuingRef = useRef(false);

  useEffect(() => {
    if (!threadId) return;
    void fetchThreadGoal(threadId);
    void fetchThreadLoop(threadId).then((loop) => {
      if (loop?.status === 'active' && getChatSettings().pendingLoop) {
        setChatSettings({ pendingLoop: false });
      }
    });
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = isRunning;
    if (wasRunning && !isRunning) {
      void fetchThreadGoal(threadId);
      void fetchThreadLoop(threadId).then((loop) => {
        if (loop?.status === 'active' && getChatSettings().pendingLoop) {
          setChatSettings({ pendingLoop: false });
        }
      });
    }
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void fetchThreadGoal(threadId);
      void fetchThreadLoop(threadId).then((loop) => {
        if (loop?.status === 'active' && getChatSettings().pendingLoop) {
          setChatSettings({ pendingLoop: false });
        }
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [threadId, isRunning]);

  useEffect(() => {
    if (!threadId || isRunning || continuingRef.current) return;

    const tick = async () => {
      if (continuingRef.current || isRunning) return;
      const goal = await fetchThreadGoal(threadId);
      if (goal?.status === 'active' && goal.needsContinuation) {
        continuingRef.current = true;
        try {
          const started = await requestSilentChatContinue();
          if (started) {
            await ackGoalContinueApi(threadId);
          }
        } finally {
          continuingRef.current = false;
        }
        return;
      }

      const loop = await fetchThreadLoop(threadId);
      if (loop?.status === 'active' && loop.nextWakeAt) {
        const due = Date.parse(loop.nextWakeAt) <= Date.now() + 500;
        if (due) {
          continuingRef.current = true;
          try {
            await ackLoopWakeApi(threadId);
            aui.composer().setText(loop.prompt);
            aui.composer().send({ startRun: true });
          } finally {
            continuingRef.current = false;
          }
        }
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [threadId, isRunning, aui]);
}

export interface AgentContextResponse {
  agentId: string;
  skills: { name: string; description: string }[];
  mcpServers: string[];
}

export function usePendingSkill() {
  const { pendingSkill, pendingSkillInsertAt } = useChatSettingsState();
  const setPendingSkill = useCallback((name: string | null, insertAt?: number) => {
    if (name === null) {
      setChatSettings({ pendingSkill: null, pendingSkillInsertAt: 0 });
      return;
    }
    setChatSettings({
      pendingSkill: name,
      pendingSkillInsertAt: insertAt ?? 0,
    });
  }, []);
  return { pendingSkill, pendingSkillInsertAt, setPendingSkill };
}

export function useAttachedBrowserTab() {
  const attachedBrowserTab = useChatSettingsState().attachedBrowserTab;
  const setAttachedBrowserTab = useCallback((tab: AttachedBrowserTab | null) => {
    setChatSettings({ attachedBrowserTab: tab });
  }, []);
  return { attachedBrowserTab, setAttachedBrowserTab };
}

export function useMcpEnabled() {
  const mcpEnabled = useChatSettingsState().mcpEnabled;
  const setServerEnabled = useCallback((serverId: string, enabled: boolean) => {
    setChatSettings({ mcpEnabled: { [serverId]: enabled } });
  }, []);
  const isServerEnabled = useCallback(
    (serverId: string) => mcpEnabled[serverId] !== false,
    [mcpEnabled],
  );
  return { mcpEnabled, setServerEnabled, isServerEnabled };
}

export function useAgentContext(enabled: boolean) {
  const [context, setContext] = useState<AgentContextResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetch('/api/agent-context')
      .then((r) => r.json())
      .then((d: AgentContextResponse) => setContext(d))
      .catch(() => setContext(null))
      .finally(() => setLoading(false));
  }, [enabled]);

  return { context, loading };
}
