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

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1]!;
  const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1];
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1];
  return {
    ...(name ? { name: unquote(name) } : {}),
    ...(description ? { description: unquote(description) } : {}),
  };
}

/**
 * Load skills from a directory. Each skill is a subfolder containing SKILL.md.
 * Uses YAML frontmatter `name` / `description` when present, otherwise falls back
 * to the first markdown heading and paragraph.
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
    const frontmatter = parseSkillFrontmatter(content);
    const nameMatch = content.match(/^#\s+(.+)$/m);
    const descMatch = content
      .split('\n')
      .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
    skills.push({
      name: frontmatter.name ?? nameMatch?.[1]?.trim() ?? entry.name,
      description: frontmatter.description ?? descMatch?.trim() ?? '',
      content,
      path: skillFile,
    });
  }
  return skills;
}
