import { parseEventOn, serializeEventOn } from './event-on';
import type { Surreal } from 'surrealdb';
import { getDb } from './client';
import { newId, normalizeId, queryRows, createRecord, upsertById, selectById, deleteById, toDbDatetime } from './query';
import type {
  AutomationRow,
  AutomationRunRow,
  AuditLogRow,
  CustomSkillRow,
  McpServerRow,
  MembershipRow,
  RuleRow,
  TaskRow,
  TenantRow,
  TenantSettingsRow,
  ThreadStateRow,
  WebhookEndpointRow,
} from './types';

function mapTenant(r: Record<string, unknown>): TenantRow {
  return {
    id: normalizeId(r.id),
    name: String(r.name ?? ''),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapMembership(r: Record<string, unknown>): MembershipRow {
  return {
    id: normalizeId(r.id),
    userId: String(r.user_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    role: (r.role as MembershipRow['role']) ?? 'member',
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapThreadState(r: Record<string, unknown>): ThreadStateRow {
  return {
    threadId: String(r.thread_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    resourceId: String(r.resource_id ?? ''),
    planMode: Boolean(r.plan_mode),
    todos: (r.todos as unknown[]) ?? [],
    activatedSkills: (r.activated_skills as Record<string, string>) ?? {},
    workingMemory: (r.working_memory as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

function mapTask(r: Record<string, unknown>): TaskRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    parentThreadId: (r.parent_thread_id as string | null) ?? null,
    agentId: String(r.agent_id ?? ''),
    prompt: String(r.prompt ?? ''),
    status: (r.status as TaskRow['status']) ?? 'queued',
    label: (r.label as string | null) ?? null,
    result: (r.result as string | null) ?? null,
    jobId: (r.job_id as string | null) ?? null,
    workerThreadId: (r.worker_thread_id as string | null) ?? null,
    subagentType: (r.subagent_type as string | null) ?? null,
    totalTokens: r.total_tokens != null ? Number(r.total_tokens) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

function mapCustomSkill(r: Record<string, unknown>): CustomSkillRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    content: String(r.content ?? ''),
    enabled: Boolean(r.enabled ?? true),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapRule(r: Record<string, unknown>): RuleRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    userId: (r.user_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    name: String(r.name ?? ''),
    content: String(r.content ?? ''),
    trigger: (r.trigger as RuleRow['trigger']) ?? 'always',
    keywords: (r.keywords as string[]) ?? [],
    enabled: Boolean(r.enabled ?? true),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapMcp(r: Record<string, unknown>): McpServerRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    name: String(r.name ?? ''),
    transport: (r.transport as McpServerRow['transport']) ?? 'sse',
    url: String(r.url ?? ''),
    headers: (r.headers as Record<string, string>) ?? {},
    enabled: Boolean(r.enabled ?? true),
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

function mapAutomation(r: Record<string, unknown>): AutomationRow {
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    userId: String(r.user_id ?? ''),
    name: String(r.name ?? ''),
    kind: (r.kind as AutomationRow['kind']) ?? 'cron',
    agentId: String(r.agent_id ?? ''),
    prompt: String(r.prompt ?? ''),
    enabled: Boolean(r.enabled ?? true),
    cron: (r.cron as string | null) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    sourceType: (r.source_type as string | null) ?? null,
    eventOn: parseEventOn(r.event_on),
    eventFilter: (r.event_filter as string | null) ?? null,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
  };
}

function mapAutomationRun(r: Record<string, unknown>): AutomationRunRow {
  return {
    id: normalizeId(r.id),
    automationId: String(r.automation_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    threadId: String(r.thread_id ?? ''),
    status: (r.status as AutomationRunRow['status']) ?? 'queued',
    result: (r.result as string | null) ?? null,
    eventContext: (r.event_context as Record<string, unknown>) ?? {},
    startedAt: String(r.started_at ?? new Date().toISOString()),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
  };
}

function mapWebhook(r: Record<string, unknown>): WebhookEndpointRow {
  const source = String(r.source ?? 'custom');
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    name: String(r.name ?? source),
    source,
    secret: String(r.secret ?? ''),
    eventKeyExpr: String(r.event_key_expr ?? 'type'),
    signatureHeader: String(
      r.signature_header ?? (source === 'github' ? 'X-Hub-Signature-256' : 'X-Signature-256'),
    ),
    enabled: r.enabled !== false,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}

async function db(): Promise<Surreal> {
  return getDb();
}

// ---- Tenants / memberships ----

export async function findTenantById(id: string): Promise<TenantRow | null> {
  const row = await selectById<Record<string, unknown>>(getDb(), 'tenant', id);
  return row ? mapTenant(row) : null;
}

export async function upsertTenant(row: { id: string; name: string }): Promise<TenantRow> {
  await upsertById(getDb(), 'tenant', row.id, { name: row.name, created_at: new Date() });
  return (await findTenantById(row.id))!;
}

export async function createTenant(name: string): Promise<TenantRow> {
  const id = newId();
  await createRecord(getDb(), 'tenant', { id, name });
  return (await findTenantById(id))!;
}

export async function findMembershipByUser(userId: string): Promise<MembershipRow | null> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM membership WHERE user_id = $userId LIMIT 1',
    { userId },
  );
  return rows[0] ? mapMembership(rows[0]) : null;
}

export async function createMembership(row: {
  userId: string;
  tenantId: string;
  role?: MembershipRow['role'];
}): Promise<MembershipRow> {
  const id = newId();
  await createRecord(getDb(), 'membership', {
    id,
    user_id: row.userId,
    tenant_id: row.tenantId,
    role: row.role ?? 'member',
  });
  return mapMembership((await selectById<Record<string, unknown>>(getDb(), 'membership', id))!);
}

// ---- Thread state ----

export async function getThreadStateRow(threadId: string): Promise<ThreadStateRow | null> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM thread_state WHERE thread_id = $threadId LIMIT 1',
    { threadId },
  );
  return rows[0] ? mapThreadState(rows[0]) : null;
}

export async function insertThreadState(row: Omit<ThreadStateRow, 'updatedAt'>): Promise<void> {
  const id = row.threadId;
  await createRecord(getDb(), 'thread_state', {
    thread_id: row.threadId,
    tenant_id: row.tenantId,
    resource_id: row.resourceId,
    plan_mode: row.planMode,
    todos: row.todos,
    activated_skills: row.activatedSkills,
    working_memory: row.workingMemory ?? null,
    title: row.title ?? null,
    updated_at: new Date(),
  });
}

export async function updateThreadState(
  threadId: string,
  patch: Partial<ThreadStateRow>,
): Promise<void> {
  const sets: string[] = ['updated_at = time::now()'];
  const vars: Record<string, unknown> = { threadId };
  if (patch.planMode !== undefined) {
    sets.push('plan_mode = $planMode');
    vars.planMode = patch.planMode;
  }
  if (patch.todos !== undefined) {
    sets.push('todos = $todos');
    vars.todos = patch.todos;
  }
  if (patch.activatedSkills !== undefined) {
    sets.push('activated_skills = $activatedSkills');
    vars.activatedSkills = patch.activatedSkills;
  }
  if (patch.workingMemory !== undefined) {
    sets.push('working_memory = $workingMemory');
    vars.workingMemory = patch.workingMemory;
  }
  if (patch.title !== undefined) {
    sets.push('title = $title');
    vars.title = patch.title;
  }
  if (patch.tenantId !== undefined) {
    sets.push('tenant_id = $tenantId');
    vars.tenantId = patch.tenantId;
  }
  if (patch.resourceId !== undefined) {
    sets.push('resource_id = $resourceId');
    vars.resourceId = patch.resourceId;
  }
  await getDb().query(
    `UPDATE thread_state SET ${sets.join(', ')} WHERE thread_id = $threadId`,
    vars,
  );
}

export async function listThreadStatesForResource(
  tenantId: string,
  resourceId: string,
): Promise<ThreadStateRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM thread_state WHERE tenant_id = $tenantId AND resource_id = $resourceId ORDER BY updated_at DESC',
    { tenantId, resourceId },
  );
  return rows.map(mapThreadState);
}

export async function listThreadStatesForTenant(tenantId: string): Promise<ThreadStateRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM thread_state WHERE tenant_id = $tenantId ORDER BY updated_at DESC',
    { tenantId },
  );
  return rows.map(mapThreadState);
}

export async function deleteThreadStateRow(threadId: string): Promise<void> {
  await getDb().query('DELETE thread_state WHERE thread_id = $threadId', { threadId });
}

// ---- Tenant settings / skills ----

export async function getTenantSettingsRow(tenantId: string): Promise<TenantSettingsRow | null> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM tenant_settings WHERE tenant_id = $tenantId LIMIT 1',
    { tenantId },
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    tenantId: String(r.tenant_id),
    disabledSkills: (r.disabled_skills as string[]) ?? [],
    disabledMcpServers: (r.disabled_mcp_servers as string[]) ?? [],
    modelSettings: (r.model_settings as TenantSettingsRow['modelSettings']) ?? undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

function isTransactionReadConflict(err: unknown): boolean {
  return String(err).includes('Transaction read conflict');
}

export async function upsertTenantSettings(
  tenantId: string,
  patch: Partial<Pick<TenantSettingsRow, 'disabledSkills' | 'disabledMcpServers' | 'modelSettings'>>,
): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const existing = (await getTenantSettingsRow(tenantId)) ?? {
        tenantId,
        disabledSkills: [],
        disabledMcpServers: [],
        modelSettings: undefined,
      };
      await upsertById(getDb(), 'tenant_settings', tenantId, {
        tenant_id: tenantId,
        disabled_skills: patch.disabledSkills ?? existing.disabledSkills,
        disabled_mcp_servers: patch.disabledMcpServers ?? existing.disabledMcpServers,
        model_settings: patch.modelSettings ?? existing.modelSettings,
        updated_at: new Date(),
      });
      return;
    } catch (err) {
      if (attempt < maxAttempts - 1 && isTransactionReadConflict(err)) {
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

export async function listCustomSkills(tenantId: string): Promise<CustomSkillRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM custom_skill WHERE tenant_id = $tenantId',
    { tenantId },
  );
  return rows.map(mapCustomSkill);
}

export async function insertCustomSkill(
  tenantId: string,
  input: { name: string; description?: string; content: string; enabled?: boolean },
): Promise<CustomSkillRow> {
  const id = newId();
  await createRecord(getDb(), 'custom_skill', {
    id,
    tenant_id: tenantId,
    name: input.name,
    description: input.description ?? '',
    content: input.content,
    enabled: input.enabled ?? true,
  });
  return mapCustomSkill((await selectById<Record<string, unknown>>(getDb(), 'custom_skill', id))!);
}

export async function updateCustomSkillRow(
  tenantId: string,
  id: string,
  patch: Partial<{ name: string; description: string; content: string; enabled: boolean }>,
): Promise<CustomSkillRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id, tenantId };
  if (patch.name != null) {
    sets.push('name = $name');
    vars.name = patch.name;
  }
  if (patch.description != null) {
    sets.push('description = $description');
    vars.description = patch.description;
  }
  if (patch.content != null) {
    sets.push('content = $content');
    vars.content = patch.content;
  }
  if (patch.enabled != null) {
    sets.push('enabled = $enabled');
    vars.enabled = patch.enabled;
  }
  if (sets.length === 0) return null;
  const existing = await selectById<Record<string, unknown>>(getDb(), 'custom_skill', id);
  if (!existing || String(existing.tenant_id) !== tenantId) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'custom_skill',
  });
  const row = await selectById<Record<string, unknown>>(getDb(), 'custom_skill', id);
  return row ? mapCustomSkill(row) : null;
}

export async function deleteCustomSkillRow(tenantId: string, id: string): Promise<boolean> {
  const before = await selectById<Record<string, unknown>>(getDb(), 'custom_skill', id);
  if (!before || String(before.tenant_id) !== tenantId) return false;
  await deleteById(getDb(), 'custom_skill', id);
  return true;
}

// ---- Rules ----

export async function listRulesRows(tenantId: string): Promise<RuleRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM rule WHERE tenant_id = $tenantId',
    { tenantId },
  );
  return rows.map(mapRule);
}

export async function insertRule(tenantId: string, input: Omit<RuleRow, 'id' | 'tenantId' | 'createdAt'>): Promise<RuleRow> {
  const id = newId();
  await createRecord(getDb(), 'rule', {
    id,
    tenant_id: tenantId,
    user_id: input.userId ?? null,
    agent_id: input.agentId ?? null,
    name: input.name,
    content: input.content,
    trigger: input.trigger,
    keywords: input.keywords,
    enabled: input.enabled,
  });
  return mapRule((await selectById<Record<string, unknown>>(getDb(), 'rule', id))!);
}

export async function updateRuleRow(
  tenantId: string,
  id: string,
  patch: Partial<RuleRow>,
): Promise<RuleRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id, tenantId };
  for (const [key, col] of [
    ['name', 'name'],
    ['content', 'content'],
    ['trigger', 'trigger'],
    ['keywords', 'keywords'],
    ['enabled', 'enabled'],
    ['userId', 'user_id'],
    ['agentId', 'agent_id'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      sets.push(`${col} = $${key}`);
      vars[key] = val;
    }
  }
  if (sets.length === 0) return null;
  const existing = await selectById<Record<string, unknown>>(getDb(), 'rule', id);
  if (!existing || String(existing.tenant_id) !== tenantId) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'rule',
  });
  const row = await selectById<Record<string, unknown>>(getDb(), 'rule', id);
  return row ? mapRule(row) : null;
}

export async function deleteRuleRow(tenantId: string, id: string): Promise<boolean> {
  const before = await selectById<Record<string, unknown>>(getDb(), 'rule', id);
  if (!before || String(before.tenant_id) !== tenantId) return false;
  await deleteById(getDb(), 'rule', id);
  return true;
}

// ---- MCP ----

export async function listMcpServerRows(tenantId: string): Promise<McpServerRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM mcp_server WHERE tenant_id = $tenantId',
    { tenantId },
  );
  return rows.map(mapMcp);
}

export async function insertMcpServer(
  tenantId: string,
  input: Omit<McpServerRow, 'id' | 'tenantId' | 'createdAt'>,
): Promise<McpServerRow> {
  const id = newId();
  await createRecord(getDb(), 'mcp_server', {
    id,
    tenant_id: tenantId,
    name: input.name,
    transport: input.transport,
    url: input.url,
    headers: input.headers,
    enabled: input.enabled,
  });
  return mapMcp((await selectById<Record<string, unknown>>(getDb(), 'mcp_server', id))!);
}

export async function updateMcpServerRow(
  tenantId: string,
  id: string,
  patch: Partial<McpServerRow>,
): Promise<McpServerRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id, tenantId };
  for (const [key, col] of [
    ['name', 'name'],
    ['transport', 'transport'],
    ['url', 'url'],
    ['headers', 'headers'],
    ['enabled', 'enabled'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      sets.push(`${col} = $${key}`);
      vars[key] = val;
    }
  }
  if (sets.length === 0) return null;
  const existing = await selectById<Record<string, unknown>>(getDb(), 'mcp_server', id);
  if (!existing || String(existing.tenant_id) !== tenantId) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'mcp_server',
  });
  const row = await selectById<Record<string, unknown>>(getDb(), 'mcp_server', id);
  return row ? mapMcp(row) : null;
}

export async function deleteMcpServerRow(tenantId: string, id: string): Promise<boolean> {
  const before = await selectById<Record<string, unknown>>(getDb(), 'mcp_server', id);
  if (!before || String(before.tenant_id) !== tenantId) return false;
  await deleteById(getDb(), 'mcp_server', id);
  return true;
}

// ---- Tasks ----

export async function insertTask(
  row: Omit<TaskRow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<TaskRow> {
  const id = row.id ?? newId();
  await createRecord(getDb(), 'task', {
    id,
    tenant_id: row.tenantId,
    parent_thread_id: row.parentThreadId ?? null,
    agent_id: row.agentId,
    prompt: row.prompt,
    status: row.status,
    label: row.label ?? null,
    result: row.result ?? null,
    job_id: row.jobId ?? null,
    worker_thread_id: row.workerThreadId ?? null,
    subagent_type: row.subagentType ?? null,
    total_tokens: row.totalTokens ?? null,
    duration_ms: row.durationMs ?? null,
    updated_at: new Date(),
  });
  return (await getTaskRow(id))!;
}

export async function getTaskRow(id: string): Promise<TaskRow | null> {
  const row = await selectById<Record<string, unknown>>(getDb(), 'task', id);
  return row ? mapTask(row) : null;
}

export async function listTasksByParentThread(parentThreadId: string): Promise<TaskRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM task WHERE parent_thread_id = $parentThreadId ORDER BY created_at DESC',
    { parentThreadId },
  );
  return rows.map(mapTask);
}

export async function updateTaskRow(
  id: string,
  patch: Partial<TaskRow>,
): Promise<TaskRow | null> {
  const sets: string[] = ['updated_at = time::now()'];
  const vars: Record<string, unknown> = { id };
  for (const [key, col] of [
    ['status', 'status'],
    ['label', 'label'],
    ['result', 'result'],
    ['jobId', 'job_id'],
    ['prompt', 'prompt'],
    ['workerThreadId', 'worker_thread_id'],
    ['subagentType', 'subagent_type'],
    ['totalTokens', 'total_tokens'],
    ['durationMs', 'duration_ms'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      sets.push(`${col} = $${key}`);
      vars[key] = val;
    }
  }
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'task',
  });
  return getTaskRow(id);
}

// ---- Automations ----

export async function listAutomationRows(tenantId: string, userId?: string): Promise<AutomationRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    userId
      ? 'SELECT * FROM automation WHERE tenant_id = $tenantId AND user_id = $userId'
      : 'SELECT * FROM automation WHERE tenant_id = $tenantId',
    { tenantId, userId },
  );
  return rows.map(mapAutomation);
}

export async function listAllCronAutomationRows(): Promise<AutomationRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    "SELECT * FROM automation WHERE kind = 'cron' AND enabled = true",
  );
  return rows.map(mapAutomation).filter((a) => !!a.cron);
}

export async function getAutomationRow(tenantId: string, id: string): Promise<AutomationRow | null> {
  const row = await selectById<Record<string, unknown>>(getDb(), 'automation', id);
  return row && String(row.tenant_id) === tenantId ? mapAutomation(row) : null;
}

export async function insertAutomation(
  tenantId: string,
  userId: string,
  input: Omit<AutomationRow, 'id' | 'tenantId' | 'userId' | 'createdAt' | 'lastRunAt'>,
): Promise<AutomationRow> {
  const id = newId();
  await createRecord(getDb(), 'automation', {
    id,
    tenant_id: tenantId,
    user_id: userId,
    name: input.name,
    kind: input.kind,
    agent_id: input.agentId,
    prompt: input.prompt,
    enabled: input.enabled,
    cron: input.cron ?? null,
    timezone: input.timezone ?? 'UTC',
    source_type: input.sourceType ?? 'cron',
    event_on: serializeEventOn(input.eventOn),
    event_filter: input.eventFilter ?? null,
  });
  return (await getAutomationRow(tenantId, id))!;
}

export async function updateAutomationRow(
  tenantId: string,
  id: string,
  patch: Partial<AutomationRow>,
): Promise<AutomationRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id, tenantId };
  for (const [key, col] of [
    ['name', 'name'],
    ['kind', 'kind'],
    ['agentId', 'agent_id'],
    ['prompt', 'prompt'],
    ['enabled', 'enabled'],
    ['cron', 'cron'],
    ['timezone', 'timezone'],
    ['sourceType', 'source_type'],
    ['eventOn', 'event_on'],
    ['eventFilter', 'event_filter'],
    ['lastRunAt', 'last_run_at'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      sets.push(`${col} = $${key}`);
      vars[key] =
        key === 'eventOn'
          ? serializeEventOn(val as string | string[] | null)
          : col === 'last_run_at'
            ? toDbDatetime(val)
            : val;
    }
  }
  if (sets.length === 0) return getAutomationRow(tenantId, id);
  const existing = await selectById<Record<string, unknown>>(getDb(), 'automation', id);
  if (!existing || String(existing.tenant_id) !== tenantId) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'automation',
  });
  return getAutomationRow(tenantId, id);
}

export async function deleteAutomationRow(tenantId: string, id: string): Promise<boolean> {
  const before = await selectById<Record<string, unknown>>(getDb(), 'automation', id);
  if (!before || String(before.tenant_id) !== tenantId) return false;
  await deleteById(getDb(), 'automation', id);
  return true;
}

export async function insertAutomationRun(
  automationId: string,
  tenantId: string,
  threadId: string,
  eventContext: Record<string, unknown> = {},
): Promise<AutomationRunRow> {
  const id = newId();
  await createRecord(getDb(), 'automation_run', {
    id,
    automation_id: automationId,
    tenant_id: tenantId,
    thread_id: threadId,
    status: 'queued',
    event_context: eventContext,
  });
  return mapAutomationRun((await selectById<Record<string, unknown>>(getDb(), 'automation_run', id))!);
}

export async function updateAutomationRunRow(
  runId: string,
  patch: Partial<AutomationRunRow>,
): Promise<AutomationRunRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { runId };
  for (const [key, col] of [
    ['status', 'status'],
    ['result', 'result'],
    ['finishedAt', 'finished_at'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      sets.push(`${col} = $${key}`);
      vars[key] = col === 'finished_at' ? toDbDatetime(val) : val;
    }
  }
  if (sets.length === 0) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'automation_run',
    id: runId,
  });
  const row = await selectById<Record<string, unknown>>(getDb(), 'automation_run', runId);
  return row ? mapAutomationRun(row) : null;
}

export async function listAutomationRunRows(
  tenantId: string,
  automationId: string,
): Promise<AutomationRunRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM automation_run WHERE tenant_id = $tenantId AND automation_id = $automationId ORDER BY started_at DESC',
    { tenantId, automationId },
  );
  return rows.map(mapAutomationRun);
}

export async function listEventAutomationRows(
  tenantId: string,
  sourceType: string,
): Promise<AutomationRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    "SELECT * FROM automation WHERE tenant_id = $tenantId AND kind = 'event' AND enabled = true",
    { tenantId },
  );
  return rows
    .map(mapAutomation)
    .filter((a) => a.sourceType === sourceType);
}

// ---- Webhooks ----

export async function listWebhookRows(tenantId: string): Promise<WebhookEndpointRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM webhook_endpoint WHERE tenant_id = $tenantId',
    { tenantId },
  );
  return rows.map(mapWebhook);
}

export async function insertWebhook(
  row: Omit<WebhookEndpointRow, 'id' | 'createdAt'>,
): Promise<WebhookEndpointRow> {
  const id = newId();
  await createRecord(getDb(), 'webhook_endpoint', {
    id,
    tenant_id: row.tenantId,
    name: row.name,
    source: row.source,
    secret: row.secret,
    event_key_expr: row.eventKeyExpr,
    signature_header: row.signatureHeader,
    enabled: row.enabled,
  });
  return mapWebhook((await selectById<Record<string, unknown>>(getDb(), 'webhook_endpoint', id))!);
}

export async function deleteWebhookRow(tenantId: string, id: string): Promise<boolean> {
  const before = await selectById<Record<string, unknown>>(getDb(), 'webhook_endpoint', id);
  if (!before || String(before.tenant_id) !== tenantId) return false;
  await deleteById(getDb(), 'webhook_endpoint', id);
  return true;
}

export async function updateWebhookRow(
  tenantId: string,
  id: string,
  patch: Partial<Pick<WebhookEndpointRow, 'name' | 'eventKeyExpr' | 'signatureHeader' | 'enabled'>>,
): Promise<WebhookEndpointRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id, tenantId };
  for (const [key, col] of [
    ['name', 'name'],
    ['eventKeyExpr', 'event_key_expr'],
    ['signatureHeader', 'signature_header'],
    ['enabled', 'enabled'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      sets.push(`${col} = $${key}`);
      vars[key] = val;
    }
  }
  if (sets.length === 0) return null;
  const existing = await selectById<Record<string, unknown>>(getDb(), 'webhook_endpoint', id);
  if (!existing || String(existing.tenant_id) !== tenantId) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'webhook_endpoint',
  });
  const row = await selectById<Record<string, unknown>>(getDb(), 'webhook_endpoint', id);
  return row ? mapWebhook(row) : null;
}

export async function getWebhookBySourceRow(
  tenantId: string,
  source: string,
): Promise<WebhookEndpointRow | null> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM webhook_endpoint WHERE tenant_id = $tenantId AND source = $source LIMIT 1',
    { tenantId, source },
  );
  return rows[0] ? mapWebhook(rows[0]) : null;
}

// ---- Audit ----

export async function insertAuditLog(row: Omit<AuditLogRow, 'id' | 'createdAt'>): Promise<void> {
  const id = newId();
  await createRecord(getDb(), 'audit_log', {
    id,
    tenant_id: row.tenantId,
    user_id: row.userId ?? null,
    thread_id: row.threadId ?? null,
    action: row.action,
    detail: row.detail ?? null,
  });
}

// suppress unused
void db;
