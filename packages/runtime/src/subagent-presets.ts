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

const READ_ONLY_TOOLS: BuiltinToolId[] = [
  'file_read',
  'list_dir',
  'grep',
  'glob',
  'web_fetch',
  'read_open_page',
];

const EXPLORE_INSTRUCTIONS = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating, modifying, or deleting files
- Running commands that change system state (mkdir, touch, rm, cp, mv, git add/commit, npm install, etc.)
- Using redirect operators (>, >>, |) or heredocs to write to files

Your role is EXCLUSIVELY to search and analyze existing code.

Guidelines:
- Use glob for broad file pattern matching and grep for content search
- Use file_read when you know the specific file path
- Use bash ONLY for read-only operations (ls, git status, git log, git diff, cat, head, tail)
- Spawn parallel read-only tool calls when searches are independent
- Return a concise, structured summary with concrete references (paths, line numbers)

Complete the search request efficiently and report findings clearly.`;

const PLAN_INSTRUCTIONS = `You are a software architect and planning specialist. Your role is to explore the codebase and design implementation plans.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
You must NOT create, modify, or delete any files. You do NOT have file editing tools.

## Your process
1. Understand the requirements in the task
2. Explore thoroughly: read files, grep/glob for patterns, trace architecture, use bash only for read-only inspection
3. Design an implementation approach with trade-offs
4. Output a step-by-step plan with dependencies, risks, and verification steps

Return the plan as your final message — structured, actionable, and scoped.`;

const GENERAL_INSTRUCTIONS = `You are a general-purpose subagent. Given the delegated task, use the tools available to complete it end to end.

Guidelines:
- Search broadly when you do not know where something lives; read when you know the path
- Prefer editing existing files over creating new ones
- Do not create documentation files unless explicitly requested
- Do not dispatch further subagents
- When done, return a concise report: what you did and key findings`;

const VERIFICATION_INSTRUCTIONS = `You are a verification specialist. Your job is to try to break the implementation — not to confirm it works.

=== DO NOT MODIFY THE PROJECT ===
Do not create, modify, or delete project files. You may run tests, builds, curl, and read-only inspection. Ephemeral scripts in /tmp are allowed if needed; clean up after.

## Strategy
1. Read README / package scripts for build & test commands
2. Run build and test suite — failures are automatic FAIL
3. Exercise the change directly (API curl, UI paths, CLI runs) — do not only read code
4. Try edge cases the implementer likely missed

Report PASS/FAIL with evidence from commands you actually ran.`;

const EDITOR_INSTRUCTIONS = `You are a code-editing subagent. Implement the requested change precisely and minimally.

Guidelines:
- Read before you edit; keep changes scoped
- Do not dispatch further subagents
- When done, summarize exactly which files changed and why`;

export const SUBAGENT_PRESETS: Record<string, SubagentPreset> = {
  explore: {
    key: 'explore',
    whenToUse:
      'Fast read-only codebase exploration: find files by pattern, search code, answer "how does X work?" Specify thoroughness: quick, medium, or very thorough.',
    model: 'deepseek',
    instructions: EXPLORE_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS, 'bash'],
    disallowedToolIds: [
      ...SUBAGENT_DENIED,
      'file_write',
      'file_edit',
    ],
    includeMcp: [],
  },
  plan: {
    key: 'plan',
    whenToUse:
      'Read-only planning: explore the codebase and produce a step-by-step implementation plan without making changes.',
    model: 'deepseek',
    instructions: PLAN_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS, 'bash'],
    disallowedToolIds: [
      ...SUBAGENT_DENIED,
      'file_write',
      'file_edit',
    ],
    includeMcp: [],
  },
  'general-purpose': {
    key: 'general-purpose',
    whenToUse:
      'General-purpose agent for complex research, multi-step tasks, and code changes when no narrower specialist fits.',
    model: 'deepseek',
    instructions: GENERAL_INSTRUCTIONS,
    fullToolset: true,
    disallowedToolIds: [...SUBAGENT_DENIED],
    includeMcp: [],
  },
  verification: {
    key: 'verification',
    whenToUse:
      'Independent verification after implementation: run builds/tests and try to break the change. Use before declaring work done.',
    model: 'deepseek',
    instructions: VERIFICATION_INSTRUCTIONS,
    allowedToolIds: [...READ_ONLY_TOOLS, 'bash'],
    disallowedToolIds: [
      ...SUBAGENT_DENIED,
      'file_write',
      'file_edit',
    ],
    includeMcp: [],
  },
  editor: {
    key: 'editor',
    whenToUse: 'Scoped code edits: read and modify files and run shell commands to implement a focused change.',
    model: 'deepseek',
    instructions: EDITOR_INSTRUCTIONS,
    allowedToolIds: [
      'file_read',
      'file_write',
      'file_edit',
      'grep',
      'glob',
      'list_dir',
      'bash',
    ],
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
