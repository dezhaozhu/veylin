import type { AgentDefinition } from '@veylin/shared';
import type { BuiltinToolId } from '@veylin/tools';

/** A built-in subagent profile dispatched via the `task` tool. */
export interface SubagentPreset {
  key: string;
  /** Shown in the task tool schema — when the parent should pick this type. */
  whenToUse: string;
  model: string;
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

const EXPLORE_INSTRUCTIONS = `You are a research specialist. Gather context from the web, open pages, and the knowledge base.

=== READ-ONLY ===
Do not modify workspace settings unless the user explicitly asks.

Guidelines:
- Use knowledge_search for uploaded documents and broad research
- Use web_fetch only when you have a concrete URL to read (from the user or context)
- Use read_open_page when the user has a page open in the desktop browser
- Return a concise, structured summary with concrete references

Complete the search request efficiently and report findings clearly.`;

const PLAN_INSTRUCTIONS = `You are a planning specialist. Explore available context and design actionable plans.

=== READ-ONLY ===
You must NOT execute mutating workspace or table operations unless the user explicitly requests them.

## Your process
1. Understand the requirements in the task
2. Gather context via knowledge_search and read_open_page; use web_fetch only for explicit URLs
3. Design an approach with trade-offs
4. Output a step-by-step plan with dependencies, risks, and verification steps

Return the plan as your final message — structured, actionable, and scoped.`;

const GENERAL_INSTRUCTIONS = `You are a general-purpose subagent. Given the delegated task, use the tools available to complete it end to end.

Guidelines:
- Use knowledge_search and read_open_page for context; web_fetch only for known URLs
- Use table_* tools for spreadsheet data when relevant
- Do not dispatch further subagents
- When done, return a concise report: what you did and key findings`;

const VERIFICATION_INSTRUCTIONS = `You are a verification specialist. Independently check whether the prior work meets the stated requirements.

=== DO NOT MODIFY WORKSPACE SETTINGS ===
Focus on verification steps the user or parent can run.

## Strategy
1. Re-read the original request and any cited sources
2. Cross-check claims against knowledge_search; use web_fetch only when you have a source URL
3. Try edge cases the primary agent likely missed

Report PASS/FAIL with evidence from steps you actually ran.`;

const EDITOR_INSTRUCTIONS = `You are a focused execution subagent. Complete the delegated task using available tools.

Guidelines:
- Gather context via knowledge_search and read_open_page; use web_fetch only for known URLs before acting
- Use table tools when the task involves spreadsheet data
- Do not dispatch further subagents
- When done, summarize exactly what changed and why`;

export const SUBAGENT_PRESETS: Record<string, SubagentPreset> = {
  explore: {
    key: 'explore',
    whenToUse:
      'Read-only research: documents, web pages, open browser tab, answer "what does X say?"',
    model: 'default',
    instructions: EXPLORE_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  plan: {
    key: 'plan',
    whenToUse:
      'Read-only planning: explore context and produce a step-by-step plan without making changes.',
    model: 'default',
    instructions: PLAN_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  'general-purpose': {
    key: 'general-purpose',
    whenToUse:
      'General-purpose agent for multi-step tasks when no narrower specialist fits.',
    model: 'default',
    instructions: GENERAL_INSTRUCTIONS,
    fullToolset: true,
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  verification: {
    key: 'verification',
    whenToUse:
      'Independent verification after substantive work. Use before declaring a task done.',
    model: 'default',
    instructions: VERIFICATION_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS],
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  editor: {
    key: 'editor',
    whenToUse: 'Scoped execution using web/table/knowledge/workspace tools for a focused task.',
    model: 'default',
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
    optional: false,
    fullToolset: preset.fullToolset === true,
  };
}

/** Lines for the task tool description listing dispatchable presets. */
export function formatPresetListing(): string {
  return Object.values(SUBAGENT_PRESETS)
    .map((p) => `"${p.key}" (${p.whenToUse})`)
    .join('; ');
}
