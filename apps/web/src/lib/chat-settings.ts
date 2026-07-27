/**
 * Client-side chat request settings shared across composer controls and the
 * AI SDK transport body. Persisted to localStorage; changes broadcast a
 * `veylin-chat-settings` event so components stay in sync.
 */
import { DEFAULT_AGENT_ID } from '@veylin/shared';
import { fetchGroupedMcpServers, type McpGroupMember } from './mcp-groups-sync';

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
  /** Goal mode armed from + menu; next user message becomes the completion condition. */
  pendingGoal: boolean;
  /** Loop mode armed from + menu; model analyzes conditions and calls loop_set when ready. */
  pendingLoop: boolean;
  /** Skill selected from + menu for the next message (UI hint). */
  pendingSkill: string | null;
  /** Character index in composer text where the skill chip is inserted. */
  pendingSkillInsertAt: number;
  /** Browser page attached via @ mention for the next message. */
  attachedBrowserTab: AttachedBrowserTab | null;
  /** MCP server on/off; omitted or true means enabled. */
  mcpEnabled: Record<string, boolean>;
  /** Name of the last grouped MCP server (project) selected, any thread. Used to
   * client-side preselect a brand-new thread's project pin before the server's
   * alphabetical auto-pin would otherwise kick in on first chat send. */
  lastProject: string | null;
}
const KEY = 'veylin-chat-settings';
const EVENT = 'veylin-chat-settings';

const DEFAULTS: ChatSettings = {
  model: '',
  agentId: DEFAULT_AGENT_ID,
  planMode: false,
  pendingGoal: false,
  pendingLoop: false,
  pendingSkill: null,
  pendingSkillInsertAt: 0,
  attachedBrowserTab: null,
  mcpEnabled: {},
  lastProject: null,
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

/**
 * Group-toggle healing.
 *
 * The removed radio-belt UI used to write per-member `mcpEnabled` values for
 * a grouped ("project") MCP server, e.g. `{"compass": false,
 * "compass-guolu": true}` after picking a project. The current UI is a plain
 * group toggle: it always writes the same value to every member, and the
 * server honors explicit-off. Users who still carry a MIXED per-member state
 * from before that change get the capability silently suppressed on
 * whichever member happens to read `false` — "Compass 未连接" on some
 * projects while others work.
 *
 * `resolveGroupToggleState` is the single source of truth for turning a
 * group's per-member state into (a) what to show the toggle as and (b) which
 * members are stale and need healing back to a uniform `true`. A MIXED state
 * is never legitimate under the current UI, so it is always treated as ON
 * (matching the old UX's implication that the group was in use) and flagged
 * for repair. Uniform all-false stays off (a real explicit off); uniform
 * on/unset stays on.
 */
export interface GroupMemberState {
  name: string;
  enabled: boolean;
}

export interface GroupToggleResolution {
  /** Effective on/off state for the group as a whole. */
  enabled: boolean;
  /** Member names whose stored value is stale and should be healed to `true`. */
  membersToHeal: string[];
}

export function resolveGroupToggleState(members: GroupMemberState[]): GroupToggleResolution {
  if (members.length === 0) return { enabled: true, membersToHeal: [] };
  const anyOn = members.some((m) => m.enabled);
  const anyOff = members.some((m) => !m.enabled);
  if (!anyOn) return { enabled: false, membersToHeal: [] };
  if (!anyOff) return { enabled: true, membersToHeal: [] };
  return { enabled: true, membersToHeal: members.filter((m) => !m.enabled).map((m) => m.name) };
}

/** Apply `resolveGroupToggleState` healing to every group and persist any repair. */
export function healLegacyMixedGroupToggles(groupedServers: McpGroupMember[]): void {
  if (groupedServers.length === 0) return;
  const { mcpEnabled } = getChatSettings();
  const byGroup = new Map<string, string[]>();
  for (const m of groupedServers) {
    const names = byGroup.get(m.group);
    if (names) names.push(m.name);
    else byGroup.set(m.group, [m.name]);
  }
  const patch: Record<string, boolean> = {};
  for (const names of byGroup.values()) {
    const { membersToHeal } = resolveGroupToggleState(
      names.map((name) => ({ name, enabled: mcpEnabled[name] !== false })),
    );
    for (const name of membersToHeal) patch[name] = true;
  }
  if (Object.keys(patch).length > 0) {
    setChatSettings({ mcpEnabled: patch });
  }
}

// Heal as soon as the grouped-server list is known. Runs once per module
// load (fetchGroupedMcpServers caches its result), well before the user can
// interact with the composer's MCP toggle or send a message — chat-request
// bodies read mcpEnabled straight from localStorage (getChatSettings), not
// through this module's React hooks, so the repair has to land in storage
// itself rather than in component state. No-op outside the browser (SSR /
// test environments have no `window` and no grouped-server list to heal).
if (typeof window !== 'undefined') {
  void fetchGroupedMcpServers().then(healLegacyMixedGroupToggles);
}
