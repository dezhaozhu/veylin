import { z } from 'zod';

/** Risk level a tool/action can carry; drives the policy + approval layer. */
export const riskLevelSchema = z.enum(['safe', 'caution', 'dangerous']);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/** Veylin definition format (agent.yaml). */
export const agentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  model: z.string().default('default'),
  instructions: z.string(),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  /** Builtin tool ids this agent must not use (denylist). */
  disallowedTools: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
  /** Tools listed here always require human approval before execution. */
  approvalRequired: z.array(z.string()).default([]),
  /** Registered agent ids this agent may dispatch via the `task` tool (empty = any). */
  subAgents: z.array(z.string()).default([]),
  /**
   * When true, the agent always runs with the full set of policy-permitted
   * builtin tools (no tool_search discovery gating). Used by the main agent.
   */
  fullToolset: z.boolean().default(false),
  /** Demo / vertical agent packs — not loaded unless VEYLIN_LOAD_OPTIONAL_AGENTS=1. */
  optional: z.boolean().default(false),
  /** Optional cron schedules: run this agent automatically on a cron expression. */
  schedules: z
    .array(
      z.object({
        name: z.string(),
        cron: z.string().describe('Cron expression, e.g. "0 8 * * *"'),
        prompt: z.string(),
      }),
    )
    .default([]),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export interface RunContext {
  tenantId: string;
  userId: string;
  threadId: string;
}
