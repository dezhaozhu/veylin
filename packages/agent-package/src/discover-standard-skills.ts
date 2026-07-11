import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { loadSkillsDir, type Skill } from './skills-dir.js';

/** User skills live only under ~/.veylin/skills/<name>/SKILL.md */
export function veylinSkillsDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.veylin', 'skills');
}

export async function loadVeylinSkills(homeDir?: string): Promise<Skill[]> {
  const root = veylinSkillsDir(homeDir);
  await fs.mkdir(root, { recursive: true });
  return loadSkillsDir(root);
}

function assertSkillName(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(trimmed)) {
    throw new Error('skill name must be alphanumeric/hyphen (max 64)');
  }
  return trimmed;
}

export async function writeVeylinSkill(input: {
  name: string;
  description?: string;
  content: string;
  homeDir?: string;
}): Promise<Skill> {
  const name = assertSkillName(input.name);
  const dir = join(veylinSkillsDir(input.homeDir), name);
  await fs.mkdir(dir, { recursive: true });
  let body = input.content.trim();
  if (!body.startsWith('---')) {
    const desc = (input.description ?? '').trim();
    body = `---\nname: ${name}\ndescription: ${desc || name}\n---\n\n${body}\n`;
  }
  await fs.writeFile(join(dir, 'SKILL.md'), body, 'utf8');
  const skillFile = join(dir, 'SKILL.md');
  const skills = await loadSkillsDir(veylinSkillsDir(input.homeDir));
  const skill = skills.find((s) => s.path === skillFile) ?? skills.find((s) => s.name === name);
  if (!skill) throw new Error('failed to write skill');
  return skill;
}

export async function deleteVeylinSkill(name: string, homeDir?: string): Promise<boolean> {
  const dir = join(veylinSkillsDir(homeDir), assertSkillName(name));
  try {
    await fs.access(dir);
  } catch {
    return false;
  }
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

/** Copy a skill folder (containing SKILL.md) into ~/.veylin/skills/<name>. */
export async function importSkillDirToVeylin(
  sourceSkillDir: string,
  homeDir?: string,
): Promise<Skill> {
  const skillFile = join(sourceSkillDir, 'SKILL.md');
  try {
    await fs.access(skillFile);
  } catch {
    throw new Error(`SKILL.md not found in ${sourceSkillDir}`);
  }
  const name = assertSkillName(basename(sourceSkillDir));
  const dest = join(veylinSkillsDir(homeDir), name);
  await fs.rm(dest, { recursive: true, force: true });
  await copyDir(sourceSkillDir, dest);
  const skills = await loadVeylinSkills(homeDir);
  const skill = skills.find((s) => s.name === name);
  if (!skill) throw new Error('import failed');
  return skill;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

/** Resolve workspace root: env override wins, then explicit setting. */
export function resolveWorkspaceRoot(setting?: string | null): string | null {
  const fromEnv = process.env.VEYLIN_WORKSPACE_ROOT?.trim();
  if (fromEnv) return fromEnv;
  const fromSetting = setting?.trim();
  return fromSetting || null;
}
