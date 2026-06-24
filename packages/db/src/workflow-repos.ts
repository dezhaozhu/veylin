import { getDb } from './client';
import { newId, normalizeId, queryRows, createRecord, selectById, deleteById, toDbDatetime } from './query';
import type { WorkflowRow, WorkflowRunRow } from './types';

function mapWorkflow(r: Record<string, unknown>): WorkflowRow {
  const def = (r.definition as { nodes?: unknown[]; edges?: unknown[] }) ?? {};
  return {
    id: normalizeId(r.id),
    tenantId: String(r.tenant_id ?? ''),
    userId: String(r.user_id ?? ''),
    name: String(r.name ?? ''),
    kind: (r.kind as WorkflowRow['kind']) ?? 'manual',
    enabled: Boolean(r.enabled ?? true),
    cron: (r.cron as string | null) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    sourceType: (r.source_type as string | null) ?? null,
    triggerFilter: (r.trigger_filter as Record<string, unknown>) ?? {},
    definition: {
      nodes: def.nodes ?? [],
      edges: def.edges ?? [],
    },
    createdAt: r.created_at ? String(r.created_at) : undefined,
    lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
  };
}

function mapWorkflowRun(r: Record<string, unknown>): WorkflowRunRow {
  return {
    id: normalizeId(r.id),
    workflowId: String(r.workflow_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    status: (r.status as WorkflowRunRow['status']) ?? 'queued',
    log: (r.log as unknown[]) ?? [],
    eventContext: (r.event_context as Record<string, unknown>) ?? {},
    startedAt: String(r.started_at ?? new Date().toISOString()),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
  };
}

export async function listWorkflowRows(tenantId: string, userId?: string): Promise<WorkflowRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    userId
      ? 'SELECT * FROM workflow WHERE tenant_id = $tenantId AND user_id = $userId ORDER BY created_at DESC'
      : 'SELECT * FROM workflow WHERE tenant_id = $tenantId ORDER BY created_at DESC',
    { tenantId, userId },
  );
  return rows.map(mapWorkflow);
}

export async function listAllScheduledWorkflowRows(): Promise<WorkflowRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    "SELECT * FROM workflow WHERE kind = 'schedule' AND enabled = true",
  );
  return rows.map(mapWorkflow).filter((w) => !!w.cron);
}

export async function listEventWorkflowRows(
  tenantId: string,
  sourceType: string,
): Promise<WorkflowRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    "SELECT * FROM workflow WHERE tenant_id = $tenantId AND kind = 'event' AND enabled = true",
    { tenantId },
  );
  return rows
    .map(mapWorkflow)
    .filter((w) => (w.sourceType ?? 'custom') === sourceType || w.sourceType === 'custom');
}

export async function getWorkflowRow(tenantId: string, id: string): Promise<WorkflowRow | null> {
  const row = await selectById<Record<string, unknown>>(getDb(), 'workflow', id);
  return row && String(row.tenant_id) === tenantId ? mapWorkflow(row) : null;
}

export async function insertWorkflow(
  tenantId: string,
  userId: string,
  input: Omit<WorkflowRow, 'id' | 'tenantId' | 'userId' | 'createdAt' | 'lastRunAt'>,
): Promise<WorkflowRow> {
  const id = newId();
  await createRecord(getDb(), 'workflow', {
    id,
    tenant_id: tenantId,
    user_id: userId,
    name: input.name,
    kind: input.kind,
    enabled: input.enabled,
    cron: input.cron ?? undefined,
    timezone: input.timezone ?? 'UTC',
    source_type: input.sourceType ?? 'cron',
    trigger_filter: input.triggerFilter ?? {},
    definition: input.definition ?? { nodes: [], edges: [] },
  });
  return (await getWorkflowRow(tenantId, id))!;
}

export async function updateWorkflowRow(
  tenantId: string,
  id: string,
  patch: Partial<WorkflowRow>,
): Promise<WorkflowRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { id, tenantId };
  for (const [key, col] of [
    ['name', 'name'],
    ['kind', 'kind'],
    ['enabled', 'enabled'],
    ['cron', 'cron'],
    ['timezone', 'timezone'],
    ['sourceType', 'source_type'],
    ['triggerFilter', 'trigger_filter'],
    ['definition', 'definition'],
    ['lastRunAt', 'last_run_at'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      if (val === null) {
        sets.push(`${col} = NONE`);
      } else {
        sets.push(`${col} = $${key}`);
        vars[key] = col === 'last_run_at' ? toDbDatetime(val) : val;
      }
    }
  }
  if (sets.length === 0) return getWorkflowRow(tenantId, id);
  const existing = await selectById<Record<string, unknown>>(getDb(), 'workflow', id);
  if (!existing || String(existing.tenant_id) !== tenantId) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'workflow',
  });
  return getWorkflowRow(tenantId, id);
}

export async function deleteWorkflowRow(tenantId: string, id: string): Promise<boolean> {
  const before = await selectById<Record<string, unknown>>(getDb(), 'workflow', id);
  if (!before || String(before.tenant_id) !== tenantId) return false;
  await deleteById(getDb(), 'workflow', id);
  return true;
}

export async function insertWorkflowRun(
  workflowId: string,
  tenantId: string,
  eventContext: Record<string, unknown> = {},
): Promise<WorkflowRunRow> {
  const id = newId();
  await createRecord(getDb(), 'workflow_run', {
    id,
    workflow_id: workflowId,
    tenant_id: tenantId,
    status: 'queued',
    log: [],
    event_context: eventContext,
  });
  return mapWorkflowRun((await selectById<Record<string, unknown>>(getDb(), 'workflow_run', id))!);
}

export async function updateWorkflowRunRow(
  runId: string,
  patch: Partial<WorkflowRunRow>,
): Promise<WorkflowRunRow | null> {
  const sets: string[] = [];
  const vars: Record<string, unknown> = { runId };
  for (const [key, col] of [
    ['status', 'status'],
    ['log', 'log'],
    ['finishedAt', 'finished_at'],
  ] as const) {
    const val = patch[key];
    if (val !== undefined) {
      if (val === null) {
        sets.push(`${col} = NONE`);
      } else {
        sets.push(`${col} = $${key}`);
        vars[key] = col === 'finished_at' ? toDbDatetime(val) : val;
      }
    }
  }
  if (sets.length === 0) return null;
  await getDb().query(`UPDATE type::thing($table, $id) SET ${sets.join(', ')}`, {
    ...vars,
    table: 'workflow_run',
    id: runId,
  });
  const row = await selectById<Record<string, unknown>>(getDb(), 'workflow_run', runId);
  return row ? mapWorkflowRun(row) : null;
}

export async function listWorkflowRunRows(
  tenantId: string,
  workflowId: string,
): Promise<WorkflowRunRow[]> {
  const rows = await queryRows<Record<string, unknown>>(
    getDb(),
    'SELECT * FROM workflow_run WHERE tenant_id = $tenantId AND workflow_id = $workflowId ORDER BY started_at DESC',
    { tenantId, workflowId },
  );
  return rows.map(mapWorkflowRun);
}

export async function getWorkflowRunRow(runId: string): Promise<WorkflowRunRow | null> {
  const row = await selectById<Record<string, unknown>>(getDb(), 'workflow_run', runId);
  return row ? mapWorkflowRun(row) : null;
}
