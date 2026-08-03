import type { Agent } from '@mastra/core/agent';
import { DEFAULT_AGENT_ID, type Runtime } from '@veylin/runtime';

export type RefreshAgentPackagesOptions = {
  /** Reload agent.yaml + bundled skills from disk even when hot reload is off. */
  force?: boolean;
};

export function isAgentHotReloadEnabled(): boolean {
  return process.env.VEYLIN_HOT_RELOAD_AGENTS === '1';
}

/** Reload agent.yaml + bundled skills from disk so customize/chat see latest files. */
export async function refreshAgentPackages(
  runtime: Runtime,
  options?: RefreshAgentPackagesOptions,
): Promise<void> {
  if (!options?.force && !isAgentHotReloadEnabled()) return;
  await runtime.reloadAgentPackages();
}

export function requireAgent(runtime: Runtime, agentId: string): Agent {
  const agent = runtime.getAgent(agentId) ?? runtime.getAgent(DEFAULT_AGENT_ID);
  if (!agent) {
    throw new Error(`Agent not configured: ${agentId}`);
  }
  return agent;
}
