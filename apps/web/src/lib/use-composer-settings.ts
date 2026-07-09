import { useAuiState } from '@assistant-ui/react';
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
import { useState } from 'react';

function applyPlanModeForThread(threadId: string | undefined, on: boolean): void {
  if (threadId) writeCachedThreadPlanMode(threadId, on);
  if (getChatSettings().planMode !== on) {
    setChatSettings({ planMode: on });
  }
}

/** Mount once per thread view — keeps composer plan UI in sync with agent tool calls. */
export function usePlanModeBridge(): void {
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
      applyPlanModeForThread(threadId, on);
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
        applyPlanModeForThread(threadId, on);
      });
      void fetchThreadTodos(threadId);
      void fetchActivatedSkills(threadId);
    }

    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void fetchThreadPlanMode(threadId).then((on) => {
        applyPlanModeForThread(threadId, on);
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
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const planMode = useChatSettingsState().planMode;

  const setPlanMode = useCallback(
    (on: boolean) => {
      applyPlanModeForThread(threadId, on);
      if (threadId) {
        void fetch('/api/plan-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId, planMode: on }),
        }).catch(() => undefined);
      }
    },
    [threadId],
  );

  const togglePlanMode = useCallback(() => setPlanMode(!planMode), [planMode, setPlanMode]);

  return { planMode, setPlanMode, togglePlanMode };
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
