import { z } from 'zod';
import type { RiskLevel } from '@veylin/shared';
import { toolRisk, type BuiltinToolId, metaToolRisk } from '@veylin/tools';

export type PolicyDecision = 'allow' | 'approve' | 'deny';

export const policyConfigSchema = z.object({
  /** Decision applied per risk level when no explicit override matches. */
  byRisk: z.record(z.enum(['safe', 'caution', 'dangerous']), z.enum(['allow', 'approve', 'deny'])),
  /** Per-tool overrides win over byRisk. */
  toolOverrides: z.record(z.string(), z.enum(['allow', 'approve', 'deny'])).default({}),
  /** Absolute path prefixes the agent may touch (empty = no restriction). */
  allowedPathPrefixes: z.array(z.string()).default([]),
});

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/** Conservative default: read freely, network with approval, mutations with approval. */
export const defaultPolicy: PolicyConfig = {
  byRisk: { safe: 'allow', caution: 'approve', dangerous: 'approve' },
  toolOverrides: {},
  allowedPathPrefixes: [],
};

/** Plan Mode: read/plan only; mutations and background tasks denied. */
export const planModePolicy: PolicyConfig = {
  byRisk: { safe: 'allow', caution: 'deny', dangerous: 'deny' },
  toolOverrides: {
    ask_user_question: 'allow',
    todo_write: 'allow',
    tool_search: 'allow',
    enter_plan_mode: 'allow',
    exit_plan_mode: 'allow',
    loop_set: 'allow',
    loop_schedule_wakeup: 'allow',
    skill: 'allow',
    web_fetch: 'allow',
    read_open_page: 'allow',
  },
  allowedPathPrefixes: [],
};

export function riskOf(toolId: string): RiskLevel {
  return (
    (toolRisk as Record<string, RiskLevel>)[toolId] ??
    metaToolRisk[toolId] ??
    'caution'
  );
}

export function evaluateTool(toolId: string, policy: PolicyConfig): PolicyDecision {
  const override = policy.toolOverrides[toolId];
  if (override) return override;
  return policy.byRisk[riskOf(toolId)] ?? 'approve';
}

export function isPathAllowed(path: string, policy: PolicyConfig): boolean {
  if (policy.allowedPathPrefixes.length === 0) return true;
  return policy.allowedPathPrefixes.some((prefix) => path.startsWith(prefix));
}

/** Tool ids the agent is allowed to even see, given the active policy. */
export function permittedToolIds(policy: PolicyConfig): BuiltinToolId[] {
  return (Object.keys(toolRisk) as BuiltinToolId[]).filter(
    (id) => evaluateTool(id, policy) !== 'deny',
  );
}
