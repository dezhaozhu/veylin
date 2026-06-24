import { useAuiState } from '@assistant-ui/react';
import { useCallback, useEffect, useState } from 'react';
import {
  getChatSettings,
  onChatSettingsChange,
  setChatSettings,
} from '@/lib/chat-settings';

export interface AgentContextResponse {
  agentId: string;
  skills: { name: string; description: string }[];
  mcpServers: string[];
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

  useEffect(() => {
    if (!threadId) return;
    fetch(`/api/plan-mode?threadId=${encodeURIComponent(threadId)}`)
      .then((r) => r.json())
      .then((d: { planMode?: boolean }) => {
        if (d.planMode != null && d.planMode !== getChatSettings().planMode) {
          setChatSettings({ planMode: d.planMode });
        }
      })
      .catch(() => undefined);
  }, [threadId]);

  const setPlanMode = useCallback(
    (on: boolean) => {
      setChatSettings({ planMode: on });
      if (threadId) {
        fetch('/api/plan-mode', {
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

export function usePendingSkill() {
  const pendingSkill = useChatSettingsState().pendingSkill;
  const setPendingSkill = useCallback((name: string | null) => {
    setChatSettings({ pendingSkill: name });
  }, []);
  return { pendingSkill, setPendingSkill };
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
