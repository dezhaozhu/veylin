/**
 * Client-side chat request settings shared across composer controls and the
 * AI SDK transport body. Persisted to localStorage; changes broadcast a
 * `veylin-chat-settings` event so components stay in sync.
 */
import { DEFAULT_AGENT_ID } from '@veylin/shared';

/** A model id from the user catalog. */
export type ModelKey = string;

export type AttachedBrowserTab = {
  tabId: string;
  url: string;
  title: string;
};

export interface ChatSettings {
  model: ModelKey;
  agentId: string;
  planMode: boolean;
  /** Skill selected from + menu for the next message (UI hint). */
  pendingSkill: string | null;
  /** Character index in composer text where the skill chip is inserted. */
  pendingSkillInsertAt: number;
  /** Browser page attached via @ mention for the next message. */
  attachedBrowserTab: AttachedBrowserTab | null;
  /** MCP server on/off; omitted or true means enabled. */
  mcpEnabled: Record<string, boolean>;
}
const KEY = 'veylin-chat-settings';
const EVENT = 'veylin-chat-settings';

const DEFAULTS: ChatSettings = {
  model: '',
  agentId: DEFAULT_AGENT_ID,
  planMode: false,
  pendingSkill: null,
  pendingSkillInsertAt: 0,
  attachedBrowserTab: null,
  mcpEnabled: {},
};

export function getChatSettings(): ChatSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChatSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setChatSettings(patch: Partial<ChatSettings>): ChatSettings {
  const current = getChatSettings();
  const next = { ...current, ...patch };
  if (patch.mcpEnabled) {
    next.mcpEnabled = { ...current.mcpEnabled, ...patch.mcpEnabled };
  }
  if (patch.pendingSkill === null) {
    next.pendingSkillInsertAt = 0;
  }
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function onChatSettingsChange(cb: (s: ChatSettings) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ChatSettings>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export const CHAT_SETTINGS_EVENT = EVENT;
