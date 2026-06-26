import {
  deleteCustomSkillRow,
  getTenantSettingsRow,
  insertCustomSkill,
  listCustomSkills,
  updateCustomSkillRow,
  upsertTenantSettings,
} from '@veylin/db';
import type { CustomSkillInput, SkillListItem } from '@veylin/shared';
import { dirname } from 'node:path';
import type { Runtime } from '@veylin/runtime';
import { refreshAgentPackages } from './agent-packages-sync';

export async function getDisabledSkills(tenantId: string): Promise<string[]> {
  const row = await getTenantSettingsRow(tenantId);
  return row?.disabledSkills ?? [];
}

export async function setDisabledSkills(tenantId: string, disabled: string[]): Promise<void> {
  const existingMcp = await getDisabledMcpServers(tenantId);
  await upsertTenantSettings(tenantId, { disabledSkills: disabled, disabledMcpServers: existingMcp });
}

export async function getDisabledMcpServers(tenantId: string): Promise<string[]> {
  const row = await getTenantSettingsRow(tenantId);
  return row?.disabledMcpServers ?? [];
}

export async function setDisabledMcpServers(tenantId: string, disabled: string[]): Promise<void> {
  const existingSkills = await getDisabledSkills(tenantId);
  await upsertTenantSettings(tenantId, { disabledSkills: existingSkills, disabledMcpServers: disabled });
}

export async function createCustomSkill(tenantId: string, input: CustomSkillInput) {
  return insertCustomSkill(tenantId, {
    name: input.name.trim(),
    description: input.description ?? '',
    content: input.content,
    enabled: input.enabled ?? true,
  });
}

export async function updateCustomSkill(
  tenantId: string,
  id: string,
  patch: Partial<CustomSkillInput>,
) {
  return updateCustomSkillRow(tenantId, id, {
    ...(patch.name != null ? { name: patch.name.trim() } : {}),
    ...(patch.description != null ? { description: patch.description } : {}),
    ...(patch.content != null ? { content: patch.content } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
  });
}

export async function deleteCustomSkill(tenantId: string, id: string): Promise<boolean> {
  return deleteCustomSkillRow(tenantId, id);
}

export async function listMergedSkills(
  runtime: Runtime,
  tenantId: string,
  agentId?: string,
): Promise<SkillListItem[]> {
  await refreshAgentPackages(runtime);
  const ctx = runtime.getAgentContext(agentId);
  const disabled = new Set(await getDisabledSkills(tenantId));
  const custom = await listCustomSkills(tenantId);

  const bundled: SkillListItem[] = ctx.skills.map((s) => ({
    name: s.name,
    description: s.description,
    source: 'bundled' as const,
    type: 'knowledge',
    triggers: [],
    enabled: !disabled.has(s.name),
  }));

  const customItems: SkillListItem[] = custom.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    source: 'custom' as const,
    type: 'knowledge',
    triggers: [],
    enabled: row.enabled,
    content: row.content,
  }));

  return [...bundled, ...customItems];
}

export function buildSkillsCatalogBlock(skills: SkillListItem[]): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return '';
  const lines = [
    '## Available Skills',
    ...enabled.map((s) => `- ${s.name}: ${s.description}`),
    'When a skill is relevant, load its full instructions with the `skill` tool before acting.',
  ];
  return lines.join('\n');
}

export async function resolveSkillContent(
  runtime: Runtime,
  tenantId: string,
  agentId: string | undefined,
  name: string,
): Promise<string | null> {
  const merged = await listMergedSkills(runtime, tenantId, agentId);
  const hit = merged.find((s) => s.name === name && s.enabled);
  if (!hit) return null;
  if (hit.content) return hit.content;

  const loaded = runtime.definitions.get(agentId ?? 'veylin');
  const fileSkill = loaded?.skills.find((s) => s.name === name);
  if (!fileSkill?.content) return null;
  const baseDir = dirname(fileSkill.path);
  return `Base directory for this skill: ${baseDir}\n\n${fileSkill.content}`;
}
