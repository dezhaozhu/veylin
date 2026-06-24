import type { AgentDefinition } from '@veylin/shared';

/** How a subagent preset may touch the production schedule toolset. */
export type SchedulePresetMode = 'none' | 'read' | 'full';

/** A built-in (non-yaml) subagent profile dispatched synchronously via the `task` tool. */
export interface SubagentPreset {
  key: string;
  description: string;
  model: 'deepseek' | 'zenmux';
  instructions: string;
  /** Builtin tool ids the subagent is allowed to use. */
  allowedToolIds: string[];
  /** Whether (and how) to expose the schedule toolset. */
  scheduleMode: SchedulePresetMode;
  /** MCP server names to expose to the subagent. */
  includeMcp: string[];
}

export const SUBAGENT_PRESETS: Record<string, SubagentPreset> = {
  explore: {
    key: 'explore',
    description:
      'Read-only investigator. Explore the codebase and the production schedule to gather ' +
      'context and answer questions. Cannot modify anything.',
    model: 'deepseek',
    instructions:
      'You are a focused, read-only research subagent. Investigate the request using the ' +
      'available read tools (files, search, schedule reads, web). Do not attempt to modify ' +
      'files or the schedule. Return a concise, structured summary of what you found, with ' +
      'concrete references (paths, line numbers, sheet/row ids) the caller can act on.',
    allowedToolIds: ['file_read', 'list_dir', 'grep', 'glob', 'web_fetch', 'read_open_page'],
    scheduleMode: 'read',
    includeMcp: [],
  },
  editor: {
    key: 'editor',
    description:
      'Code editor. Read and modify files and run shell commands to implement a scoped change.',
    model: 'deepseek',
    instructions:
      'You are a code-editing subagent. Implement the requested change precisely and minimally. ' +
      'Read before you edit, keep edits scoped, and avoid unrelated changes. When done, summarize ' +
      'exactly which files you changed and why.',
    allowedToolIds: ['file_read', 'file_write', 'file_edit', 'grep', 'glob', 'list_dir', 'bash'],
    scheduleMode: 'none',
    includeMcp: [],
  },
  scheduler: {
    key: 'scheduler',
    description:
      'Production scheduling specialist. Read and modify the schedule grid (rows, columns, sheets).',
    model: 'deepseek',
    instructions:
      'You are a production-scheduling subagent. Use the schedule tools to read and adjust the ' +
      'grid as requested. Be safety-aware: explain risky changes. Destructive operations ' +
      '(deleting rows/columns/sheets) require human approval. Summarize the changes you made.',
    allowedToolIds: ['file_read', 'grep', 'glob', 'list_dir'],
    scheduleMode: 'full',
    includeMcp: ['scheduling'],
  },
  general: {
    key: 'general',
    description: 'Balanced general-purpose subagent for mixed read and light analysis tasks.',
    model: 'deepseek',
    instructions:
      'You are a general-purpose subagent. Handle the delegated task end to end using the ' +
      'available tools, preferring reads and planning before any change. Return a concise summary.',
    allowedToolIds: ['file_read', 'list_dir', 'grep', 'glob', 'web_fetch', 'read_open_page'],
    scheduleMode: 'read',
    includeMcp: [],
  },
};

export type SubagentType = keyof typeof SUBAGENT_PRESETS;

export const SUBAGENT_TYPES = Object.keys(SUBAGENT_PRESETS) as SubagentType[];

/** Mastra agent id for a registered subagent preset. */
export function subagentAgentId(key: string): string {
  return `subagent-${key}`;
}

/** Synthesize an AgentDefinition for a preset so it can go through buildAgent. */
export function presetToDefinition(preset: SubagentPreset): AgentDefinition {
  return {
    id: subagentAgentId(preset.key),
    name: `Subagent: ${preset.key}`,
    description: preset.description,
    model: preset.model,
    instructions: preset.instructions,
    skills: [],
    tools: preset.allowedToolIds,
    mcpServers: preset.includeMcp,
    approvalRequired: [],
    subAgents: [],
    schedules: [],
    fullToolset: false,
  };
}
