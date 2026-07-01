import type { Agent } from '@mastra/core/agent';
import { DEFAULT_AGENT_ID, type Runtime } from '@veylin/runtime';

/** Reload agent.yaml + bundled skills from disk so customize/chat see latest files. */
export async function refreshAgentPackages(runtime: Runtime): Promise<void> {
  await runtime.reloadAgentPackages();
}

export function requireAgent(runtime: Runtime, agentId: string): Agent {
  const agent = runtime.getAgent(agentId) ?? runtime.getAgent(DEFAULT_AGENT_ID);
  if (!agent) {
    throw new Error(`Agent not configured: ${agentId}`);
  }
  return agent;
}
