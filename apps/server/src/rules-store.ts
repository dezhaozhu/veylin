import {
  deleteRuleRow,
  insertRule,
  listRulesRows,
  updateRuleRow,
} from '@veylin/db';
import type { Rule, RuleInput } from '@veylin/shared';

function rowToRule(row: Awaited<ReturnType<typeof listRulesRows>>[number]): Rule {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    agentId: row.agentId,
    name: row.name,
    content: row.content,
    trigger: row.trigger,
    keywords: row.keywords ?? [],
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export async function listRules(tenantId: string, userId?: string, agentId?: string) {
  const rows = await listRulesRows(tenantId);
  return rows
    .filter((r) => !r.userId || !userId || r.userId === userId)
    .filter((r) => !r.agentId || !agentId || r.agentId === agentId)
    .map(rowToRule);
}

export async function createRule(tenantId: string, input: RuleInput) {
  const row = await insertRule(tenantId, {
    userId: input.userId ?? null,
    agentId: input.agentId ?? null,
    name: input.name.trim(),
    content: input.content,
    trigger: input.trigger,
    keywords: input.keywords ?? [],
    enabled: input.enabled ?? true,
  });
  return rowToRule(row);
}

export async function updateRule(tenantId: string, id: string, patch: Partial<RuleInput>) {
  const row = await updateRuleRow(tenantId, id, {
    ...(patch.name != null ? { name: patch.name.trim() } : {}),
    ...(patch.content != null ? { content: patch.content } : {}),
    ...(patch.trigger != null ? { trigger: patch.trigger } : {}),
    ...(patch.keywords != null ? { keywords: patch.keywords } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
    ...(patch.userId !== undefined ? { userId: patch.userId } : {}),
    ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
  });
  return row ? rowToRule(row) : null;
}

export async function deleteRule(tenantId: string, id: string): Promise<boolean> {
  return deleteRuleRow(tenantId, id);
}

export function buildRulesMemoryBlock(
  rules: Rule[],
  lastUserMessage: string,
): string {
  const enabled = rules.filter((r) => r.enabled);
  const always = enabled.filter((r) => r.trigger === 'always');
  const keyword = enabled.filter((r) => r.trigger === 'keyword');
  const msg = lastUserMessage.toLowerCase();

  const matchedKeyword = keyword.filter((r) =>
    r.keywords.some((kw) => kw && msg.includes(kw.toLowerCase())),
  );

  const active = [...always, ...matchedKeyword];
  if (active.length === 0) return '';

  const lines = ['## User Rules'];
  for (const rule of active) {
    lines.push(`### ${rule.name}`, rule.content);
  }
  return lines.join('\n');
}
