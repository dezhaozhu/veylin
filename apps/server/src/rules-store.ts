import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { listRulesRows } from '@veylin/db';
import type { Rule, RuleInput } from '@veylin/shared';
import { veylinRulesDir } from './veylin-paths.js';

type RuleFrontmatter = {
  name?: string;
  trigger?: 'always' | 'keyword';
  keywords?: string[];
  enabled?: boolean;
  userId?: string | null;
  agentId?: string | null;
};

function assertRuleName(name: string): string {
  const n = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(n)) {
    throw new Error('Invalid rule name');
  }
  return n;
}

function parseFrontmatter(raw: string): { meta: RuleFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const yaml = match[1]!;
  const body = match[2]!.trim();
  const read = (key: string) => {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1]!.trim().replace(/^['"]|['"]$/g, '') : undefined;
  };
  const keywordsRaw = read('keywords');
  let keywords: string[] | undefined;
  if (keywordsRaw) {
    if (keywordsRaw.startsWith('[')) {
      try {
        keywords = JSON.parse(keywordsRaw.replace(/'/g, '"')) as string[];
      } catch {
        keywords = keywordsRaw
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
    } else {
      keywords = keywordsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  const trigger = read('trigger');
  const enabledRaw = read('enabled');
  return {
    meta: {
      ...(read('name') ? { name: read('name') } : {}),
      ...(trigger === 'always' || trigger === 'keyword' ? { trigger } : {}),
      ...(keywords ? { keywords } : {}),
      ...(enabledRaw != null ? { enabled: enabledRaw.toLowerCase() !== 'false' } : {}),
      ...(read('userId') !== undefined
        ? { userId: read('userId') === 'null' ? null : read('userId') ?? null }
        : {}),
      ...(read('agentId') !== undefined
        ? { agentId: read('agentId') === 'null' ? null : read('agentId') ?? null }
        : {}),
    },
    body,
  };
}

function serializeRule(rule: {
  name: string;
  content: string;
  trigger: 'always' | 'keyword';
  keywords: string[];
  enabled: boolean;
  userId?: string | null;
  agentId?: string | null;
}): string {
  const lines = [
    '---',
    `name: ${rule.name}`,
    `trigger: ${rule.trigger}`,
    `enabled: ${rule.enabled}`,
  ];
  if (rule.keywords.length > 0) {
    lines.push(`keywords: [${rule.keywords.map((k) => JSON.stringify(k)).join(', ')}]`);
  }
  if (rule.userId) lines.push(`userId: ${rule.userId}`);
  if (rule.agentId) lines.push(`agentId: ${rule.agentId}`);
  lines.push('---', '', rule.content.trim(), '');
  return lines.join('\n');
}

function fileToRule(tenantId: string, name: string, raw: string, mtime?: Date): Rule {
  const { meta, body } = parseFrontmatter(raw);
  return {
    id: name,
    tenantId,
    userId: meta.userId ?? null,
    agentId: meta.agentId ?? null,
    name: meta.name ?? name,
    content: body,
    trigger: meta.trigger ?? 'always',
    keywords: meta.keywords ?? [],
    enabled: meta.enabled !== false,
    createdAt: mtime?.toISOString(),
  };
}

let rulesMigrated = false;

async function migrateRulesFromDb(tenantId: string): Promise<void> {
  if (rulesMigrated) return;
  rulesMigrated = true;
  const dir = veylinRulesDir();
  try {
    const entries = await fs.readdir(dir);
    if (entries.some((e) => e.endsWith('.md'))) return;
  } catch {
    // dir missing
  }
  try {
    const rows = await listRulesRows(tenantId);
    if (rows.length === 0) return;
    await fs.mkdir(dir, { recursive: true });
    for (const row of rows) {
      const name = assertRuleName(row.name);
      const path = join(dir, `${name}.md`);
      await fs.writeFile(
        path,
        serializeRule({
          name,
          content: row.content,
          trigger: row.trigger as 'always' | 'keyword',
          keywords: row.keywords ?? [],
          enabled: row.enabled,
          userId: row.userId,
          agentId: row.agentId,
        }),
        'utf8',
      );
    }
    console.info(`[veylin] migrated ${rows.length} rule(s) to ~/.veylin/rules`);
  } catch (err) {
    console.warn('[veylin] rules migration skipped:', err);
  }
}

export async function listRules(tenantId: string, userId?: string, agentId?: string) {
  await migrateRulesFromDb(tenantId);
  const dir = veylinRulesDir();
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const rules: Rule[] = [];
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    const path = join(dir, file);
    const raw = await fs.readFile(path, 'utf8');
    const st = await fs.stat(path);
    const rule = fileToRule(tenantId, name, raw, st.mtime);
    if (rule.userId && userId && rule.userId !== userId) continue;
    if (rule.agentId && agentId && rule.agentId !== agentId) continue;
    rules.push(rule);
  }
  return rules.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createRule(tenantId: string, input: RuleInput) {
  await migrateRulesFromDb(tenantId);
  const name = assertRuleName(input.name);
  const dir = veylinRulesDir();
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  try {
    await fs.access(path);
    throw new Error(`Rule already exists: ${name}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Rule already')) throw err;
    // ENOENT — ok to create
  }
  const rule = {
    name,
    content: input.content,
    trigger: input.trigger ?? 'always',
    keywords: input.keywords ?? [],
    enabled: input.enabled ?? true,
    userId: input.userId ?? null,
    agentId: input.agentId ?? null,
  };
  await fs.writeFile(path, serializeRule(rule), 'utf8');
  return fileToRule(tenantId, name, serializeRule(rule));
}

export async function updateRule(tenantId: string, id: string, patch: Partial<RuleInput>) {
  await migrateRulesFromDb(tenantId);
  const currentName = id;
  const dir = veylinRulesDir();
  const path = join(dir, `${currentName}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
  const existing = fileToRule(tenantId, currentName, raw);
  const nextName = patch.name != null ? assertRuleName(patch.name) : existing.name;
  const next = {
    name: nextName,
    content: patch.content ?? existing.content,
    trigger: patch.trigger ?? existing.trigger,
    keywords: patch.keywords ?? existing.keywords,
    enabled: patch.enabled ?? existing.enabled,
    userId: patch.userId !== undefined ? patch.userId : existing.userId,
    agentId: patch.agentId !== undefined ? patch.agentId : existing.agentId,
  };
  const nextPath = join(dir, `${nextName}.md`);
  await fs.writeFile(nextPath, serializeRule(next), 'utf8');
  if (nextName !== currentName) {
    await fs.rm(path, { force: true });
  }
  return fileToRule(tenantId, nextName, serializeRule(next));
}

export async function deleteRule(_tenantId: string, id: string): Promise<boolean> {
  const path = join(veylinRulesDir(), `${id}.md`);
  try {
    await fs.rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
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
