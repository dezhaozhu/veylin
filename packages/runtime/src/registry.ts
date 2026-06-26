import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import type { Agent } from '@mastra/core/agent';
import type { Memory } from '@mastra/memory';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { loadAgentDefinition, loadSkillsDir, type Skill } from '@veylin/agent-package';
import type { AgentDefinition } from '@veylin/shared';
import { defaultPolicy, planModePolicy, type PolicyConfig } from '@veylin/policy';
import { buildMemory } from './memory';
import { buildAgent } from './agents';
import { SUBAGENT_PRESETS, presetToDefinition } from './subagent-presets';

export const DEFAULT_AGENT_ID = 'veylin';

const DEFAULT_AGENT: AgentDefinition = {
  id: DEFAULT_AGENT_ID,
  name: 'Veylin',
  description: 'General industrial operations assistant.',
  model: 'deepseek',
  instructions:
    'You are an industrial operations assistant supporting factory production, ' +
    'scheduling, and equipment workflows. Apply the general guidance above to this ' +
    'domain: reason about work orders, schedules, and operational risk, and treat ' +
    'production-data or schedule changes as high-stakes actions that warrant a plan ' +
    'and approval before execution.',
  skills: [],
  tools: [],
  mcpServers: [],
  approvalRequired: [],
  subAgents: [],
  schedules: [],
  fullToolset: true,
};

export interface LoadedAgent {
  definition: AgentDefinition;
  skills: Skill[];
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
}

export interface AgentContext {
  agentId: string;
  skills: { name: string; description: string }[];
  mcpServers: string[];
}

export interface Runtime {
  mastra: Mastra;
  /** Shared memory (threads + working memory + semantic recall). */
  memory: Memory;
  /** Loaded agent definitions, including the built-in default. */
  definitions: Map<string, LoadedAgent>;
  /** Directory scanned for agent.yaml + skills (reloaded on demand). */
  agentsDir?: string;
  /** List registered agents for UI pickers. */
  listAgents(): AgentSummary[];
  /** Skills + MCP metadata for the default (or given) agent package. */
  getAgentContext(agentId?: string): AgentContext;
  getAgent(id: string): Agent | undefined;
  /** Build (and register) an extra agent at runtime. */
  createAgent(def: AgentDefinition, policy?: PolicyConfig, skills?: Skill[]): Agent;
  /** Reload agent.yaml and bundled skills from agentsDir. */
  reloadAgentPackages(): Promise<void>;
}

export interface CreateRuntimeOptions {
  /** App data directory (used to derive LibSQL url when libsqlUrl omitted). */
  dataDir: string;
  libsqlUrl?: string;
  agentsDir?: string;
}

function filterSkills(skills: Skill[], declared: string[]): Skill[] {
  if (declared.length === 0) return skills;
  return skills.filter((s) => declared.includes(s.name));
}

/** Load every `<dir>/<name>/agent.yaml` plus its sibling `skills/` directory. */
export async function loadAgentsFromDir(dir: string): Promise<LoadedAgent[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const loaded: LoadedAgent[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const yamlPath = join(dir, entry.name, 'agent.yaml');
    try {
      const definition = await loadAgentDefinition(yamlPath);
      const skills = await loadSkillsDir(join(dir, entry.name, 'skills'));
      loaded.push({ definition, skills });
    } catch {
      // Skip folders without a valid agent.yaml.
    }
  }
  return loaded;
}

async function loadDefinitionsFromAgentsDir(agentsDir?: string): Promise<Map<string, LoadedAgent>> {
  const definitions = new Map<string, LoadedAgent>();
  definitions.set(DEFAULT_AGENT.id, { definition: DEFAULT_AGENT, skills: [] });
  if (agentsDir) {
    for (const item of await loadAgentsFromDir(agentsDir)) {
      definitions.set(item.definition.id, item);
    }
  }
  return definitions;
}

export async function createRuntime(
  opts: CreateRuntimeOptions | string,
): Promise<Runtime> {
  const resolved: CreateRuntimeOptions =
    typeof opts === 'string'
      ? { dataDir: '.', libsqlUrl: opts }
      : opts;
  const libsqlUrl = resolved.libsqlUrl ?? `file:${join(resolved.dataDir, 'mastra-memory.db')}`;

  const memory = buildMemory(libsqlUrl);
  const agentsDir = resolved.agentsDir;
  const definitions = await loadDefinitionsFromAgentsDir(agentsDir);
  const agentById = new Map<string, Agent>();

  const registerPackageAgent = (id: string, loaded: LoadedAgent) => {
    const filteredSkills = filterSkills(loaded.skills, loaded.definition.skills);
    agentById.set(
      id,
      buildAgent({ definition: loaded.definition, memory, policy: defaultPolicy, skills: filteredSkills }),
    );
  };

  for (const [id, loaded] of definitions) {
    registerPackageAgent(id, loaded);
  }

  for (const preset of Object.values(SUBAGENT_PRESETS)) {
    const definition = presetToDefinition(preset);
    agentById.set(definition.id, buildAgent({ definition, memory, policy: defaultPolicy }));
  }

  const mastra = new Mastra({
    agents: Object.fromEntries(agentById),
    logger: new PinoLogger({ name: 'veylin', level: 'info' }),
  });

  const reloadAgentPackages = async () => {
    if (!agentsDir) return;
    const next = await loadDefinitionsFromAgentsDir(agentsDir);
    for (const [id, loaded] of next) {
      definitions.set(id, loaded);
      registerPackageAgent(id, loaded);
    }
    for (const id of [...definitions.keys()]) {
      if (!next.has(id)) {
        definitions.delete(id);
        agentById.delete(id);
      }
    }
  };

  return {
    mastra,
    memory,
    definitions,
    agentsDir,
    listAgents() {
      return [...definitions.values()].map(({ definition }) => ({
        id: definition.id,
        name: definition.name,
        description: definition.description,
      }));
    },
    getAgentContext(agentId = DEFAULT_AGENT_ID) {
      const loaded =
        definitions.get(agentId) ?? definitions.get(DEFAULT_AGENT_ID)!;
      const { definition, skills } = loaded;
      const filtered = filterSkills(skills, definition.skills);
      return {
        agentId: definition.id,
        skills: filtered.map((s) => ({
          name: s.name,
          description: s.description,
        })),
        mcpServers: definition.mcpServers ?? [],
      };
    },
    getAgent(id) {
      return agentById.get(id);
    },
    createAgent(def, policy = defaultPolicy, skills = []) {
      const agent = buildAgent({ definition: def, memory, policy, skills });
      agentById.set(def.id, agent);
      return agent;
    },
    reloadAgentPackages,
  };
}

export { planModePolicy };
