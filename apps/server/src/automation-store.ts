import {
  deleteAutomationRow,
  getAutomationRow,
  insertAutomation,
  insertAutomationRun,
  listAllCronAutomationRows,
  listAutomationRows,
  listAutomationRunRows,
  listEventAutomationRows,
  listIncompleteAutomationRunRows,
  updateAutomationRow,
  updateAutomationRunRow,
} from '@veylin/db';
import type { Automation, AutomationInput, AutomationRun } from '@veylin/shared';
import { validateWebhookFilter } from './webhook-filter';

const RUN_INTERRUPTED_MESSAGE =
  'Run interrupted (server restarted or the worker stopped before completion)';

function rowToAutomation(row: NonNullable<Awaited<ReturnType<typeof getAutomationRow>>>): Automation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    name: row.name,
    kind: row.kind,
    agentId: row.agentId,
    prompt: row.prompt,
    enabled: row.enabled,
    cron: row.cron,
    timezone: row.timezone,
    sourceType: (row.sourceType as Automation['sourceType']) ?? 'cron',
    eventOn: row.eventOn ?? undefined,
    eventFilter: row.eventFilter ?? undefined,
    createdAt: row.createdAt,
    lastRunAt: row.lastRunAt,
  };
}

function rowToRun(row: Awaited<ReturnType<typeof insertAutomationRun>>): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    tenantId: row.tenantId,
    threadId: row.threadId,
    status: row.status,
    result: row.result,
    eventContext: row.eventContext ?? {},
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listAutomations(tenantId: string, userId?: string): Promise<Automation[]> {
  const rows = await listAutomationRows(tenantId, userId);
  return rows.map(rowToAutomation);
}

export async function listAllCronAutomations(): Promise<Automation[]> {
  const rows = await listAllCronAutomationRows();
  return rows.map(rowToAutomation);
}

export async function getAutomation(tenantId: string, id: string): Promise<Automation | null> {
  const row = await getAutomationRow(tenantId, id);
  return row ? rowToAutomation(row) : null;
}

export async function createAutomation(
  tenantId: string,
  userId: string,
  input: AutomationInput,
): Promise<Automation> {
  if (input.eventFilter?.trim()) {
    const filterResult = validateWebhookFilter(input.eventFilter);
    if (!filterResult.ok) throw new Error(filterResult.error);
  }
  const row = await insertAutomation(tenantId, userId, {
    name: input.name.trim(),
    kind: input.kind,
    agentId: input.agentId,
    prompt: input.prompt,
    enabled: input.enabled ?? true,
    cron: input.cron ?? null,
    timezone: input.timezone ?? 'UTC',
    sourceType: input.sourceType ?? (input.kind === 'event' ? 'github' : 'cron'),
    eventOn: input.eventOn ?? null,
    eventFilter: input.eventFilter ?? null,
  });
  return rowToAutomation(row);
}

export async function updateAutomation(
  tenantId: string,
  id: string,
  patch: Partial<AutomationInput> & { enabled?: boolean },
): Promise<Automation | null> {
  if (patch.eventFilter !== undefined && patch.eventFilter?.trim()) {
    const filterResult = validateWebhookFilter(patch.eventFilter);
    if (!filterResult.ok) throw new Error(filterResult.error);
  }
  const row = await updateAutomationRow(tenantId, id, {
    ...(patch.name != null ? { name: patch.name.trim() } : {}),
    ...(patch.kind != null ? { kind: patch.kind } : {}),
    ...(patch.agentId != null ? { agentId: patch.agentId } : {}),
    ...(patch.prompt != null ? { prompt: patch.prompt } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
    ...(patch.cron !== undefined ? { cron: patch.cron ?? null } : {}),
    ...(patch.timezone != null ? { timezone: patch.timezone } : {}),
    ...(patch.sourceType != null ? { sourceType: patch.sourceType } : {}),
    ...(patch.eventOn !== undefined ? { eventOn: patch.eventOn ?? null } : {}),
    ...(patch.eventFilter !== undefined ? { eventFilter: patch.eventFilter ?? null } : {}),
  });
  return row ? rowToAutomation(row) : null;
}

export async function deleteAutomation(tenantId: string, id: string): Promise<boolean> {
  return deleteAutomationRow(tenantId, id);
}

export async function touchAutomationLastRun(
  tenantId: string,
  automationId: string,
): Promise<void> {
  await updateAutomationRow(tenantId, automationId, {
    lastRunAt: new Date().toISOString(),
  });
}

/** Mark automation runs stuck in running/queued as failed after a restart. */
export async function sweepInterruptedAutomationRuns(): Promise<number> {
  const rows = await listIncompleteAutomationRunRows();
  if (rows.length === 0) return 0;
  const finishedAt = new Date().toISOString();
  for (const row of rows) {
    await updateAutomationRunRow(row.id, {
      status: 'failed',
      result: RUN_INTERRUPTED_MESSAGE,
      finishedAt,
    });
  }
  return rows.length;
}

export async function createAutomationRun(
  automationId: string,
  tenantId: string,
  threadId: string,
  eventContext: Record<string, unknown> = {},
) {
  const row = await insertAutomationRun(automationId, tenantId, threadId, eventContext);
  return rowToRun(row);
}

export async function updateAutomationRun(
  runId: string,
  patch: Partial<Pick<AutomationRun, 'status' | 'result' | 'finishedAt'>>,
) {
  const row = await updateAutomationRunRow(runId, patch);
  return row ? rowToRun(row) : null;
}

export async function listAutomationRuns(
  tenantId: string,
  automationId: string,
): Promise<AutomationRun[]> {
  const rows = await listAutomationRunRows(tenantId, automationId);
  return rows.map(rowToRun);
}

export function automationScheduleName(automationId: string): string {
  return `auto:${automationId}`;
}

export { matchesEventTrigger, matchesEventKey } from './event-trigger-matcher';

export async function listEventAutomations(tenantId: string, sourceType: string) {
  const rows = await listEventAutomationRows(tenantId, sourceType);
  return rows.map(rowToAutomation);
}
