import { Agent } from '@mastra/core/agent';
import { TokenLimiter } from '@mastra/core/processors';
import type { Memory } from '@mastra/memory';
import type { AgentDefinition } from '@veylin/shared';
import { builtinTools, makeSkillTool, toolSearch, type BuiltinToolId } from '@veylin/tools';
import type { Skill } from '@veylin/agent-package';
import {
  evaluateTool,
  defaultPolicy,
  planModePolicy,
  permittedToolIds,
  type PolicyConfig,
} from '@veylin/policy';
import { getModelConfig, type ModelKey } from './models';
import { ContextCompression } from './processors/contextCompression';
import { buildSummarizer } from './summarizer';
import { inputTokenLimit } from './token-limit';
import { composeInstructions } from './prompts/systemPrompt';

/** Always available without tool_search discovery. */
const ALWAYS_ON_TOOLS: BuiltinToolId[] = [
  'todo_write',
  'ask_user_question',
  'read_open_page',
  'enter_plan_mode',
  'exit_plan_mode',
];

function resolveActiveToolIds(
  definition: AgentDefinition,
  permitted: BuiltinToolId[],
  discovered: string[],
): BuiltinToolId[] {
  const denied = new Set(
    (definition.disallowedTools ?? []).filter((t): t is BuiltinToolId => t in builtinTools),
  );
  const applyDeny = (ids: BuiltinToolId[]) => ids.filter((id) => !denied.has(id));

  const discoveredBuiltins = discovered.filter(
    (id): id is BuiltinToolId => id in builtinTools && permitted.includes(id as BuiltinToolId),
  );
  const declared = definition.tools.filter((t): t is BuiltinToolId => t in builtinTools);

  if (definition.fullToolset && declared.length === 0) {
    return applyDeny(Array.from(new Set([...permitted, ...discoveredBuiltins])));
  }

  if (declared.length > 0) {
    const base = declared.filter((id) => permitted.includes(id));
    return applyDeny(Array.from(new Set([...base, ...discoveredBuiltins])));
  }

  const alwaysOn = ALWAYS_ON_TOOLS.filter((id) => permitted.includes(id));
  return applyDeny(Array.from(new Set([...alwaysOn, ...discoveredBuiltins])));
}

export interface BuildAgentOptions {
  definition: AgentDefinition;
  memory: Memory;
  policy?: PolicyConfig;
  planPolicy?: PolicyConfig;
  skills?: Skill[];
}

type AnyTool = (typeof builtinTools)[BuiltinToolId];
type ToolMap = Record<string, AnyTool>;

function withApprovalOverrides(policy: PolicyConfig, approvalRequired: string[]): PolicyConfig {
  if (approvalRequired.length === 0) return policy;
  const toolOverrides = { ...policy.toolOverrides };
  for (const id of approvalRequired) toolOverrides[id] = 'approve';
  return { ...policy, toolOverrides };
}

function whitelistFor(definition: AgentDefinition, permitted: BuiltinToolId[]): BuiltinToolId[] {
  const declared = definition.tools.filter((t): t is BuiltinToolId => t in builtinTools);
  if (declared.length === 0) return permitted;
  return permitted.filter((id) => declared.includes(id));
}

function applyPolicyToTool(
  id: string,
  base: AnyTool,
  policy: PolicyConfig,
): AnyTool | null {
  const decision = evaluateTool(id, policy);
  if (decision === 'deny') return null;
  const needsApproval = decision === 'approve' || base.requireApproval === true;
  return { ...base, requireApproval: needsApproval } as AnyTool;
}

function toolMapFor(ids: BuiltinToolId[], policy: PolicyConfig): ToolMap {
  const map: ToolMap = {};
  for (const id of ids) {
    const applied = applyPolicyToTool(id, builtinTools[id], policy);
    if (applied) map[id] = applied;
  }
  return map;
}

function buildInstructions(definition: AgentDefinition): string {
  return composeInstructions(definition.instructions);
}

export function buildAgent({
  definition,
  memory,
  policy = defaultPolicy,
  planPolicy = planModePolicy,
  skills = [],
}: BuildAgentOptions): Agent {
  const basePolicy = withApprovalOverrides(policy, definition.approvalRequired);
  const planPolicyEff = withApprovalOverrides(planPolicy, definition.approvalRequired);
  const skillTool = skills.length > 0 ? makeSkillTool(skills) : null;

  return new Agent({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    instructions: buildInstructions(definition),
    defaultOptions: {
      // Tool calls (web_fetch, etc.) need a follow-up model turn in the same run.
      maxSteps: 25,
    },
    model: ({ requestContext }: { requestContext?: { get(key: string): unknown } }) => {
      const requested = requestContext?.get('model') as ModelKey | undefined;
      return getModelConfig(requested ?? (definition.model as ModelKey));
    },
    memory,
    tools: ({ requestContext }: { requestContext?: { get(key: string): unknown } }) => {
      const planMode = requestContext?.get('planMode') === true;
      const activePolicy = planMode ? planPolicyEff : basePolicy;
      const permitted = whitelistFor(definition, permittedToolIds(activePolicy));
      const discovered = (requestContext?.get('discoveredToolIds') as string[] | undefined) ?? [];
      const ids = resolveActiveToolIds(definition, permitted, discovered);
      const map = toolMapFor(ids, activePolicy);
      const toolSearchApplied = applyPolicyToTool('tool_search', toolSearch as unknown as AnyTool, activePolicy);
      if (toolSearchApplied) map.tool_search = toolSearchApplied;
      if (skillTool) {
        const skillApplied = applyPolicyToTool('skill', skillTool as unknown as AnyTool, activePolicy);
        if (skillApplied) map.skill = skillApplied;
      }
      return map;
    },
    inputProcessors: [
      new ContextCompression({ summarizer: buildSummarizer(definition.model as ModelKey) }),
      new TokenLimiter({ limit: inputTokenLimit() }),
    ],
  });
}

export function toolNeedsApproval(toolId: string, policy: PolicyConfig = defaultPolicy): boolean {
  return evaluateTool(toolId, policy) === 'approve';
}

export { ContextCompression, buildSummarizer };
