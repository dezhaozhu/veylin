import type { CustomSkillInput, SkillListItem } from '@veylin/shared';
import {
  DEFAULT_AGENT_ID,
  buildSkillsCatalogBlock,
  formatSkillCatalogDescription,
  parseSkillFrontmatter,
  skillActivationBody,
} from '@veylin/shared';
import { dirname } from 'node:path';
import {
  deleteVeylinSkill,
  importSkillDirToVeylin,
  loadVeylinSkills,
  veylinSkillsDir,
  writeVeylinSkill,
  type Skill,
} from '@veylin/agent-package';
import type { Runtime } from '@veylin/runtime';
export {
  getDisabledSkills,
  setDisabledSkills,
  getDisabledMcpServers,
  setDisabledMcpServers,
  getDisabledHooks,
  setDisabledHooks,
  getWorkspaceRootSetting,
  setWorkspaceRootSetting,
} from './veylin-settings-file.js';
import { getDisabledSkills } from './veylin-settings-file.js';

export function getVeylinSkillsDir(): string {
  return veylinSkillsDir();
}

function userSkillListItem(skill: Skill, disabled: Set<string>): SkillListItem {
  const frontmatter = parseSkillFrontmatter(skill.content);
  return {
    id: skill.name,
    name: skill.name,
    description: formatSkillCatalogDescription(frontmatter, skill.description),
    source: 'user',
    type: 'knowledge',
    triggers: [],
    enabled: !disabled.has(skill.name),
    disableModelInvocation: skill.disableModelInvocation,
    userInvocable: skill.userInvocable,
    content: skill.content,
    path: skill.path,
  };
}

/** Optional plugin skills injected by the plugin registry (namespaced). */
let pluginSkillsProvider: ((tenantId: string) => Promise<SkillListItem[]>) | null = null;

export function setPluginSkillsProvider(
  provider: ((tenantId: string) => Promise<SkillListItem[]>) | null,
): void {
  pluginSkillsProvider = provider;
}

export async function createUserSkill(input: CustomSkillInput): Promise<SkillListItem> {
  const skill = await writeVeylinSkill({
    name: input.name,
    description: input.description,
    content: input.content,
  });
  const disabled = new Set(input.enabled === false ? [skill.name] : []);
  return userSkillListItem(skill, disabled);
}

export async function updateUserSkill(
  name: string,
  patch: Partial<CustomSkillInput>,
): Promise<SkillListItem | null> {
  const existing = (await loadVeylinSkills()).find((s) => s.name === name);
  if (!existing) return null;
  const nextName = patch.name?.trim() || existing.name;
  const skill = await writeVeylinSkill({
    name: nextName,
    description: patch.description ?? existing.description,
    content: patch.content ?? existing.content,
  });
  if (nextName !== name) {
    await deleteVeylinSkill(name);
  }
  return userSkillListItem(skill, new Set());
}

export async function deleteUserSkill(name: string): Promise<boolean> {
  return deleteVeylinSkill(name);
}

export async function importUserSkillFromDir(sourceDir: string): Promise<SkillListItem> {
  const skill = await importSkillDirToVeylin(sourceDir);
  return userSkillListItem(skill, new Set());
}

export async function listMergedSkills(
  runtime: Runtime,
  tenantId: string,
  agentId?: string,
): Promise<SkillListItem[]> {
  const ctx = runtime.getAgentContext(agentId);
  const disabled = new Set(await getDisabledSkills(tenantId));
  const userSkills = await loadVeylinSkills();

  const byName = new Map<string, SkillListItem>();

  for (const s of ctx.skills) {
    byName.set(s.name, {
      name: s.name,
      description: s.description,
      source: 'bundled',
      type: 'knowledge',
      triggers: [],
      enabled: !disabled.has(s.name),
      disableModelInvocation: s.disableModelInvocation,
      userInvocable: s.userInvocable,
      path: 'path' in s ? (s as { path?: string }).path : undefined,
    });
  }

  for (const skill of userSkills) {
    byName.set(skill.name, userSkillListItem(skill, disabled));
  }

  if (pluginSkillsProvider) {
    const pluginSkills = await pluginSkillsProvider(tenantId);
    for (const item of pluginSkills) {
      byName.set(item.name, {
        ...item,
        enabled: item.enabled && !disabled.has(item.name),
      });
    }
  }

  return [...byName.values()];
}

export { buildSkillsCatalogBlock } from '@veylin/shared';

export async function resolveSkillContent(
  runtime: Runtime,
  tenantId: string,
  agentId: string | undefined,
  name: string,
): Promise<string | null> {
  const merged = await listMergedSkills(runtime, tenantId, agentId);
  const hit = merged.find((s) => s.name === name && s.enabled);
  if (!hit) return null;

  if (hit.content) {
    const baseDir = hit.path ? dirname(hit.path) : undefined;
    return skillActivationBody(hit.content, baseDir);
  }

  const loaded = runtime.definitions.get(agentId ?? DEFAULT_AGENT_ID);
  const fileSkill = loaded?.skills.find((s) => s.name === name);
  if (!fileSkill?.content) return null;
  const baseDir = dirname(fileSkill.path);
  return skillActivationBody(fileSkill.content, baseDir);
}
