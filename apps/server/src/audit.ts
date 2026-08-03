import { insertAuditLog } from '@veylin/db';

export async function recordAudit(entry: {
  tenantId: string;
  userId?: string;
  threadId?: string;
  action: string;
  detail?: unknown;
}): Promise<void> {
  try {
    await insertAuditLog({
      tenantId: entry.tenantId,
      userId: entry.userId ?? null,
      threadId: entry.threadId ?? null,
      action: entry.action,
      detail: entry.detail ?? null,
    });
  } catch (err) {
    console.warn('[audit] failed to record:', (err as Error).message);
  }
}
