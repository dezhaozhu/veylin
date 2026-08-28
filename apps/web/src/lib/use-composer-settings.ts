import { useAui, useAuiState } from '@assistant-ui/store';
import { useThreadProjectsOrNull } from '@/lib/thread-projects-sync';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPendingQuote,
  onPendingQuoteChange,
  quoteThreadIds,
  setPendingQuote as writePendingQuote,
} from '@/lib/pending-quote';
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
import { isPageVisible, isServerThreadId, nextGoalLoopDelay } from '@/lib/thread-heartbeat';
import { requestChatStop } from '@/lib/chat-stop';
import {
  fetchGroupedMcpServers,
  readCachedGroupedMcpServers,
  type McpGroupMember,
} from '@/lib/mcp-groups-sync';
import {
  fetchThreadProject,
  readCachedThreadProject,
  subscribeThreadProject,
  threadProjectStamp,
  writeCachedThreadProject,
} from '@/lib/project-sync';

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
    if (!threadId || !isServerThreadId(threadId)) return;
    void fetchThreadGoal(threadId);
    void fetchThreadLoop(threadId).then((loop) => {
      if (loop?.status === 'active' && getChatSettings().pendingLoop) {
        setChatSettings({ pendingLoop: false });
      }
    });
  }, [threadId]);

  useEffect(() => {
    if (!threadId || !isServerThreadId(threadId)) return;
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
    let cancelled = false;
    let timer: number | undefined;   // window.setTimeout 返回 number,不是 Node 的 Timeout
    const poll = () => {
      if (cancelled) return;
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      if (!isPageVisible()) return;
      void fetchThreadGoal(threadId);
      void fetchThreadLoop(threadId).then((loop) => {
        if (loop?.status === 'active' && getChatSettings().pendingLoop) {
          setChatSettings({ pendingLoop: false });
        }
      });
      const delay = nextGoalLoopDelay({
        visible: true,
        chatRunning: true,
        goalActive: false,
        loopActive: false,
      });
      if (delay != null) timer = window.setTimeout(poll, delay);
    };
    poll();
    const onVis = () => {
      if (isPageVisible()) poll();
      else if (timer) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [threadId, isRunning]);

  useEffect(() => {
    if (!threadId || !isServerThreadId(threadId) || isRunning || continuingRef.current) return;

    let cancelled = false;
    let timer: number | undefined;   // window.setTimeout 返回 number,不是 Node 的 Timeout
    let goalActive = false;
    let loopActive = false;

    const schedule = () => {
      if (cancelled) return;
      const delay = nextGoalLoopDelay({
        visible: isPageVisible(),
        chatRunning: false,
        goalActive,
        loopActive,
      });
      if (delay == null) return;
      timer = window.setTimeout(() => {
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (cancelled || continuingRef.current || isRunning) return;
      if (!isPageVisible()) return;
      const goal = await fetchThreadGoal(threadId);
      goalActive = goal?.status === 'active';
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
        if (!cancelled) schedule();
        return;
      }

      const loop = await fetchThreadLoop(threadId);
      loopActive = loop?.status === 'active';
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
      if (!cancelled) schedule();
    };

    void tick();
    const onVis = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      if (!isPageVisible()) return;
      void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
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

export function usePendingQuote() {
  const localId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId ?? null,
  );
  const threadIds = quoteThreadIds({ id: localId, remoteId });
  const threadKey = threadIds.join('\0');
  const [, bump] = useState(0);
  useEffect(() => onPendingQuoteChange(() => bump((n) => n + 1)), []);

  const pendingQuote = getPendingQuote(threadIds);
  const setPendingQuote = useCallback(
    (text: string | null) => {
      writePendingQuote(threadKey ? threadKey.split('\0') : [], text);
    },
    [threadKey],
  );
  return { pendingQuote, setPendingQuote };
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

/**
 * Grouped MCP servers (capability plane, for the flyout's groupOf) + the
 * current thread's project pin (a first-class project id since v3; display
 * name lookup lives with the consumers via lib/projects-sync.ts).
 *
 * Read-only: switching a thread's project pin happens exclusively from the
 * sidebar's Projects section (project-list.tsx new-chat-in-project,
 * thread-list-item.tsx move-to-project menu), which POST /api/project
 * directly. A brand-new thread with no pin stays unpinned — it lands in the
 * 个人 (personal) area by design; there is no preselect/auto-pin here.
 */
export function useProjectScope() {
  const threadId = useAuiState(
    (s) =>
      s.threadListItem.remoteId ??
      s.threadListItem.externalId ??
      s.threadListItem.id,
  );
  const [groupedServers, setGroupedServers] = useState<McpGroupMember[]>(
    () => readCachedGroupedMcpServers() ?? [],
  );
  const [currentProject, setCurrentProject] = useState<string | null>(
    () => readCachedThreadProject(threadId) ?? null,
  );

  useEffect(() => {
    void fetchGroupedMcpServers().then(setGroupedServers);
  }, []);

  useEffect(() => {
    if (!threadId) {
      setCurrentProject(null);
      return;
    }
    const cached = readCachedThreadProject(threadId);
    if (cached !== undefined) setCurrentProject(cached);
    let cancelled = false;
    // 别人写了就跟着更新 —— 项目页是"先切线程、再钉",钉定落地时这条 effect
    // 早就跑完了,没有这条订阅,界面会一直停在"没有项目"(用户实测)。
    const off = subscribeThreadProject(() => {
      const now = readCachedThreadProject(threadId);
      if (now !== undefined) setCurrentProject(now);
    });
    // 查询**先发后到**会把已经钉好的值盖回 null。取一次戳记,回来对一下。
    const at = threadProjectStamp(threadId);
    void fetchThreadProject(threadId).then((project) => {
      if (cancelled || threadProjectStamp(threadId) !== at) return;
      writeCachedThreadProject(threadId, project);
      setCurrentProject(project);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [threadId]);

  // **钉定这件事有两份缓存**:这里这份是一次性 fetch,没有任何通知;另一份
  // (thread-projects-sync)带监听和 invalidate。项目页是"先建线程、再钉",
  // 于是这份往往在钉定之前就读完并缓存了 null —— 输入框上的 chip 就一直显示
  // 「项目」(未归属),而这条对话明明已经归在项目里(实测)。
  // 以有监听的那份为准,自己这份只当它还没加载时的兜底。
  //
  // **但共享那份对刚建出来的线程还没有条目**:项目页点一张上下文卡、或在输入框里
  // 打第一个字,线程是这一刻才建的,`shared[threadId]` 是 undefined —— 从前写成
  // `?? null`,等于把本地这份**已经知道**的钉定丢掉,chip 显示成"没有项目",
  // 人会以为自己掉进了个人对话(用户实测,e2e 对账过:服务端其实钉对了)。
  // 共享那份有条目就听它(改钉、取消钉定以它为准),没有才用本地这份兜底。
  const shared = useThreadProjectsOrNull();
  const pin = (shared && threadId ? shared[threadId] : undefined) ?? currentProject;

  return { threadId, groupedServers, currentProject: pin };
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
