import type { AgentDefinition } from '@veylin/shared';
import type { BuiltinToolId } from '@veylin/tools';

/** A built-in subagent profile dispatched via the `task` tool. */
export interface SubagentPreset {
  key: string;
  /** Shown in the task tool schema — when the parent should pick this type. */
  whenToUse: string;
  model: 'deepseek' | 'zenmux';
  instructions: string;
  /** When true, use every policy-permitted builtin (task tool still withheld at runtime). */
  fullToolset?: boolean;
  /** Allowlist of builtin tool ids (ignored when fullToolset). */
  allowedToolIds?: BuiltinToolId[];
  /** Denied builtin tools applied on top of the resolved set. */
  disallowedToolIds: BuiltinToolId[];
  /** MCP server names to expose to the subagent. */
  includeMcp: string[];
}

const SUBAGENT_DENIED: BuiltinToolId[] = [
  'enter_plan_mode',
  'exit_plan_mode',
  'ask_user_question',
];

const READ_ONLY_TOOLS: BuiltinToolId[] = ['web_fetch', 'read_open_page'];

const EXPLORE_INSTRUCTIONS = `You are a research specialist. Gather context from the web and open pages.

=== READ-ONLY ===
Do not modify workspace settings unless the user explicitly asks.

Guidelines:
- Use web_fetch for public URLs
- Use read_open_page when the user has a page open in the desktop browser
- Return a concise, structured summary with concrete references

Complete the search request efficiently and report findings clearly.`;

const PLAN_INSTRUCTIONS = `You are a planning specialist. Your role is to explore available context and design implementation plans.

=== READ-ONLY ===
You must NOT execute mutating workspace or table operations unless the user explicitly requests them.

## Your process
1. Understand the requirements in the task
2. Gather context via web_fetch / read_open_page and ask the parent for missing facts
3. Design an approach with trade-offs
4. Output a step-by-step plan with dependencies, risks, and verification steps

Return the plan as your final message — structured, actionable, and scoped.`;

const GENERAL_INSTRUCTIONS = `You are a general-purpose subagent. Given the delegated task, use the tools available to complete it end to end.

Guidelines:
- Use web_fetch and read_open_page for external context
- Use table_* tools for spreadsheet data when relevant
- Do not dispatch further subagents
- When done, return a concise report: what you did and key findings`;

const VERIFICATION_INSTRUCTIONS = `You are a verification specialist. Your job is to try to break the implementation — not to confirm it works.

=== DO NOT MODIFY WORKSPACE SETTINGS ===
Focus on verification steps the user or parent can run.

## Strategy
1. Read any README or docs via web_fetch if URLs are provided
2. Exercise the change directly when possible
3. Try edge cases the implementer likely missed

Report PASS/FAIL with evidence from steps you actually ran.`;

const EDITOR_INSTRUCTIONS = `You are a focused implementation subagent. Implement the requested change using available tools.

Guidelines:
- Gather context via web_fetch / read_open_page before acting
- Use table tools when the task involves spreadsheet data
- Do not dispatch further subagents
- When done, summarize exactly what changed and why`;

export const SUBAGENT_PRESETS: Record<string, SubagentPreset> = {
  explore: {
    key: 'explore',
    whenToUse:
      'Read-only research: fetch web pages, read the open browser page, answer "what does X say?"',
    model: 'deepseek',
    instructions: EXPLORE_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  plan: {
    key: 'plan',
    whenToUse:
      'Read-only planning: explore context and produce a step-by-step plan without making changes.',
    model: 'deepseek',
    instructions: PLAN_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  'general-purpose': {
    key: 'general-purpose',
    whenToUse:
      'General-purpose agent for multi-step tasks when no narrower specialist fits.',
    model: 'deepseek',
    instructions: GENERAL_INSTRUCTIONS,
    fullToolset: true,
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  verification: {
    key: 'verification',
    whenToUse:
      'Independent verification after implementation. Use before declaring work done.',
    model: 'deepseek',
    instructions: VERIFICATION_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  editor: {
    key: 'editor',
    whenToUse: 'Scoped changes using web/table/workspace tools for a focused task.',
    model: 'deepseek',
    instructions: EDITOR_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS, 'todo_write'],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
};

export type SubagentType = keyof typeof SUBAGENT_PRESETS;

export const SUBAGENT_TYPES = Object.keys(SUBAGENT_PRESETS) as SubagentType[];

/** Mastra agent id for a registered subagent preset. */
export function subagentAgentId(key: string): string {
  return `subagent-${key}`;
}

export function isSubagentPresetKey(key: string): key is SubagentType {
  return key in SUBAGENT_PRESETS;
}

/** Synthesize an AgentDefinition for a preset so it can go through buildAgent. */
export function presetToDefinition(preset: SubagentPreset): AgentDefinition {
  const denied = Array.from(new Set(preset.disallowedToolIds));
  return {
    id: subagentAgentId(preset.key),
    name: `Subagent: ${preset.key}`,
    description: preset.whenToUse,
    model: preset.model,
    instructions: preset.instructions,
    skills: [],
    tools: preset.fullToolset ? [] : (preset.allowedToolIds ?? []),
    disallowedTools: denied,
    mcpServers: preset.includeMcp,
    approvalRequired: [],
    subAgents: [],
    schedules: [],
    fullToolset: preset.fullToolset === true,
  };
}

/** Lines for the task tool description listing dispatchable presets. */
export function formatPresetListing(): string {
  return Object.values(SUBAGENT_PRESETS)
    .map((p) => `"${p.key}" (${p.whenToUse})`)
    .join('; ');
}
