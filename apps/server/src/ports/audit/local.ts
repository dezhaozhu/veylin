import { getTenantSettingsRow, insertAuditLog, listAuditLogs, upsertTenantSettings } from '@veylin/db';
import type { AuditEvent, AuditPort, AuditRow } from '../types.js';

export type AuditSettingsView = {
  webhookUrl: string;
};

async function resolveSinkUrl(tenantId: string): Promise<string> {
  try {
    const row = await getTenantSettingsRow(tenantId);
    const fromTenant = row?.auditSettings?.webhookUrl?.trim() ?? '';
    if (fromTenant) return fromTenant;
  } catch {
    // fall through to env
  }
  return process.env.AUDIT_WEBHOOK_URL?.trim() ?? '';
}

function forward(sinkUrl: string, event: AuditEvent): void {
  void fetch(sinkUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: event.tenantId,
      userId: event.userId,
      threadId: event.threadId,
      action: event.action,
      detail: event.detail,
      at: new Date().toISOString(),
    }),
  }).catch((err) => {
    console.warn('[audit] sink forward failed:', err instanceof Error ? err.message : err);
  });
}

/**
 * Local Surreal audit_log + optional forward to tenant webhook (UI) or AUDIT_WEBHOOK_URL.
 */
export function createLocalAuditPort(): AuditPort {
  return {
    id: 'local',
    async record(event: AuditEvent): Promise<void> {
      try {
        await insertAuditLog({
          tenantId: event.tenantId,
          userId: event.userId,
          threadId: event.threadId ?? null,
          action: event.action,
          detail: event.detail ?? null,
        });
      } catch (err) {
        console.warn('[audit] record failed:', err instanceof Error ? err.message : err);
      }
      const sinkUrl = await resolveSinkUrl(event.tenantId);
      if (sinkUrl) forward(sinkUrl, event);
    },
    async list(tenantId: string, opts?: { limit?: number }): Promise<AuditRow[]> {
      return listAuditLogs(tenantId, opts);
    },
  };
}

export async function getAuditSettings(tenantId: string): Promise<AuditSettingsView> {
  const row = await getTenantSettingsRow(tenantId);
  const fromTenant = row?.auditSettings?.webhookUrl?.trim() ?? '';
  if (fromTenant) return { webhookUrl: fromTenant };
  // Surface env default in UI as empty (editable override); do not leak env into tenant save.
  return { webhookUrl: '' };
}

export async function updateAuditSettings(
  tenantId: string,
  patch: { webhookUrl?: string },
): Promise<AuditSettingsView> {
  const webhookUrl = (patch.webhookUrl ?? '').trim();
  await upsertTenantSettings(tenantId, { auditSettings: { webhookUrl } });
  return { webhookUrl };
}
