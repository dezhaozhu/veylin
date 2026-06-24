import { parse as parseYaml } from 'yaml';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { agentDefinitionSchema, type AgentDefinition } from '@veylin/shared';

export interface Skill {
  name: string;
  description: string;
  /** Full SKILL.md body, injected into the system prompt when activated. */
  content: string;
  path: string;
}

/** Load and validate an agent.yaml into an AgentDefinition. */
export async function loadAgentDefinition(yamlPath: string): Promise<AgentDefinition> {
  const raw = await fs.readFile(resolve(yamlPath), 'utf8');
  const parsed = parseYaml(raw);
  return agentDefinitionSchema.parse(parsed);
}

/**
 * Load skills from a directory. Each skill is a subfolder containing SKILL.md
 * whose first heading is the name and first paragraph the description.
 */
export async function loadSkillsDir(dir: string): Promise<Skill[]> {
  const root = resolve(dir);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(root, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = await fs.readFile(skillFile, 'utf8');
    } catch {
      continue;
    }
    const nameMatch = content.match(/^#\s+(.+)$/m);
    const descMatch = content.split('\n').find((l) => l.trim() && !l.startsWith('#'));
    skills.push({
      name: nameMatch?.[1]?.trim() ?? entry.name,
      description: descMatch?.trim() ?? '',
      content,
      path: skillFile,
    });
  }
  return skills;
}
