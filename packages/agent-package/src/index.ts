import { parse as parseYaml } from 'yaml';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { agentDefinitionSchema, type AgentDefinition } from '@veylin/shared';

export type { Skill } from './skills-dir.js';
export { loadSkillsDir } from './skills-dir.js';

/** Load and validate an agent.yaml into an AgentDefinition. */
export async function loadAgentDefinition(yamlPath: string): Promise<AgentDefinition> {
  const raw = await fs.readFile(resolve(yamlPath), 'utf8');
  const parsed = parseYaml(raw);
  return agentDefinitionSchema.parse(parsed);
}

export {
  veylinSkillsDir,
  loadVeylinSkills,
  writeVeylinSkill,
  deleteVeylinSkill,
  importSkillDirToVeylin,
  resolveWorkspaceRoot,
} from './discover-standard-skills.js';
