import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  formatSkillCatalogDescription,
  parseSkillFrontmatter,
} from '@veylin/shared';

export interface Skill {
  name: string;
  description: string;
  /** Full SKILL.md body, injected into the system prompt when activated. */
  content: string;
  path: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
}

/**
 * Load skills from a directory. Each skill is a subfolder containing SKILL.md.
 * Uses YAML frontmatter when present, otherwise falls back to heading / first line.
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
    const fallbackName = nameMatch?.[1]?.trim() ?? entry.name;
    const fallbackDescription = descMatch?.trim() ?? '';
    skills.push({
      name: frontmatter.name ?? fallbackName,
      description: formatSkillCatalogDescription(frontmatter, fallbackDescription),
      content,
      path: skillFile,
      disableModelInvocation: frontmatter.disableModelInvocation ?? false,
      userInvocable: frontmatter.userInvocable ?? true,
    });
  }
  return skills;
}
