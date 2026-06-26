import {
  deleteWorkflowRow,
  getWorkflowRow,
  insertWorkflow,
  insertWorkflowRun,
  listAllCronWorkflowRows,
  listEventWorkflowRows,
  listWorkflowRows,
  listWorkflowRunRows,
  updateWorkflowRow,
  updateWorkflowRunRow,
} from '@veylin/db';
import type { Workflow, WorkflowInput, WorkflowRun, WorkflowRunLogEntry } from '@veylin/shared';

export class WorkflowNameConflictError extends Error {
  constructor(name: string) {
    super(`A workflow named "${name}" already exists`);
    this.name = 'WorkflowNameConflictError';
  }
}

async function assertUniqueWorkflowName(
  tenantId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const trimmed = name.trim();
  const rows = await listWorkflowRows(tenantId);
  if (rows.some((r) => r.name.trim() === trimmed && r.id !== excludeId)) {
    throw new WorkflowNameConflictError(trimmed);
  }
}

function rowToWorkflow(row: NonNullable<Awaited<ReturnType<typeof getWorkflowRow>>>): Workflow {
  const def = row.definition as Workflow['definition'];
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    cron: row.cron,
    timezone: row.timezone,
    sourceType: (row.sourceType as Workflow['sourceType']) ?? 'cron',
    eventOn: row.eventOn ?? undefined,
    eventFilter: row.eventFilter ?? undefined,
    definition: {
      nodes: (def?.nodes ?? []) as Workflow['definition']['nodes'],
      edges: (def?.edges ?? []) as Workflow['definition']['edges'],
    },
    createdAt: row.createdAt,
    lastRunAt: row.lastRunAt,
  };
}

function rowToRun(row: Awaited<ReturnType<typeof insertWorkflowRun>>): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflowId,
    tenantId: row.tenantId,
    status: row.status,
    log: (row.log as WorkflowRunLogEntry[]) ?? [],
    eventContext: row.eventContext ?? {},
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listWorkflows(tenantId: string, userId?: string): Promise<Workflow[]> {
  const rows = await listWorkflowRows(tenantId, userId);
  return rows.map(rowToWorkflow);
}

export async function listAllCronWorkflows(): Promise<Workflow[]> {
  const rows = await listAllCronWorkflowRows();
  return rows.map(rowToWorkflow);
}

export async function getWorkflow(tenantId: string, id: string): Promise<Workflow | null> {
  const row = await getWorkflowRow(tenantId, id);
  return row ? rowToWorkflow(row) : null;
}

export async function createWorkflow(
  tenantId: string,
  userId: string,
  input: WorkflowInput,
): Promise<Workflow> {
  const trimmedName = input.name.trim();
  await assertUniqueWorkflowName(tenantId, trimmedName);
  const row = await insertWorkflow(tenantId, userId, {
    name: trimmedName,
    kind: input.kind ?? 'manual',
    enabled: input.enabled ?? true,
    cron: input.cron ?? null,
    timezone: input.timezone ?? 'UTC',
    sourceType: input.sourceType ?? (input.kind === 'event' ? 'github' : 'cron'),
    eventOn: input.eventOn ?? null,
    eventFilter: input.eventFilter ?? null,
    definition: input.definition ?? { nodes: [], edges: [] },
  });
  return rowToWorkflow(row);
}

export async function updateWorkflow(
  tenantId: string,
  id: string,
  patch: Partial<WorkflowInput> & { enabled?: boolean },
): Promise<Workflow | null> {
  if (patch.name != null) {
    await assertUniqueWorkflowName(tenantId, patch.name, id);
  }
  const row = await updateWorkflowRow(tenantId, id, {
    ...(patch.name != null ? { name: patch.name.trim() } : {}),
    ...(patch.kind != null ? { kind: patch.kind } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
    ...(patch.cron !== undefined ? { cron: patch.cron ?? null } : {}),
    ...(patch.timezone != null ? { timezone: patch.timezone } : {}),
    ...(patch.sourceType != null ? { sourceType: patch.sourceType } : {}),
    ...(patch.eventOn !== undefined ? { eventOn: patch.eventOn ?? null } : {}),
    ...(patch.eventFilter !== undefined ? { eventFilter: patch.eventFilter ?? null } : {}),
    ...(patch.definition != null ? { definition: patch.definition } : {}),
  });
  return row ? rowToWorkflow(row) : null;
}

export async function deleteWorkflow(tenantId: string, id: string): Promise<boolean> {
  return deleteWorkflowRow(tenantId, id);
}

export async function touchWorkflowLastRun(workflowId: string, tenantId: string): Promise<void> {
  await updateWorkflowRow(tenantId, workflowId, {
    lastRunAt: new Date().toISOString(),
  });
}

export async function createWorkflowRun(
  workflowId: string,
  tenantId: string,
  eventContext: Record<string, unknown> = {},
) {
  const row = await insertWorkflowRun(workflowId, tenantId, eventContext);
  return rowToRun(row);
}

export async function updateWorkflowRun(
  runId: string,
  patch: Partial<Pick<WorkflowRun, 'status' | 'log' | 'finishedAt'>>,
) {
  const row = await updateWorkflowRunRow(runId, patch);
  return row ? rowToRun(row) : null;
}

export async function listWorkflowRuns(
  tenantId: string,
  workflowId: string,
): Promise<WorkflowRun[]> {
  const rows = await listWorkflowRunRows(tenantId, workflowId);
  return rows.map(rowToRun);
}

export async function listEventWorkflows(tenantId: string, sourceType: string) {
  const rows = await listEventWorkflowRows(tenantId, sourceType);
  return rows.map(rowToWorkflow);
}

export { matchesEventTrigger } from './event-trigger-matcher';
