import {
  deleteWorkflowRow,
  getWorkflowRow,
  insertWorkflow,
  insertWorkflowRun,
  listAllCronWorkflowRows,
  listEventWorkflowRows,
  listIncompleteWorkflowRunRows,
  listWorkflowRows,
  listWorkflowRunRows,
  updateWorkflowRow,
  updateWorkflowRunRow,
} from '@veylin/db';
import { deriveFinalOutput, type Workflow, type WorkflowInput, type WorkflowRun, type WorkflowRunLogEntry } from '@veylin/shared';

export class WorkflowNameConflictError extends Error {
  constructor(name: string) {
    super(`A workflow named "${name}" already exists`);
    this.name = 'WorkflowNameConflictError';
  }
}

async function assertUniqueWorkflowName(
  tenantId: string,
  threadId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const trimmed = name.trim();
  const rows = await listWorkflowRows(tenantId, { threadId });
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
    threadId: row.threadId,
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
  const log = (row.log as WorkflowRunLogEntry[]) ?? [];
  return {
    id: row.id,
    workflowId: row.workflowId,
    tenantId: row.tenantId,
    status: row.status,
    log,
    eventContext: row.eventContext ?? {},
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    finalOutput: deriveFinalOutput(log),
  };
}

export async function listWorkflows(
  tenantId: string,
  options: { userId?: string; threadId: string },
): Promise<Workflow[]> {
  const rows = await listWorkflowRows(tenantId, options);
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
  const threadId = input.threadId.trim();
  await assertUniqueWorkflowName(tenantId, threadId, trimmedName);
  const row = await insertWorkflow(tenantId, userId, {
    threadId,
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
  const existing = await getWorkflow(tenantId, id);
  if (!existing) return null;
  const threadId = patch.threadId?.trim() || existing.threadId;
  if (patch.name != null) {
    await assertUniqueWorkflowName(tenantId, threadId, patch.name, id);
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

const RUN_INTERRUPTED_MESSAGE =
  'Run interrupted (server restarted or the worker stopped before completion)';

export async function sweepInterruptedWorkflowRuns(): Promise<number> {
  const rows = await listIncompleteWorkflowRunRows();
  if (rows.length === 0) return 0;
  const finishedAt = new Date().toISOString();
  for (const row of rows) {
    const log = (row.log as WorkflowRunLogEntry[]) ?? [];
    await updateWorkflowRunRow(row.id, {
      status: 'failed',
      finishedAt,
      log: [
        ...log,
        {
          nodeId: '_',
          kind: 'start',
          status: 'error',
          message: RUN_INTERRUPTED_MESSAGE,
          at: finishedAt,
        },
      ],
    });
  }
  return rows.length;
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
