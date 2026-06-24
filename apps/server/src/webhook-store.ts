import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import {
  deleteWebhookRow,
  getWebhookByTokenRow,
  insertWebhook,
  listWebhookRows,
} from '@veylin/db';
import type { WebhookEndpoint } from '@veylin/shared';

function rowToWebhook(
  row: Awaited<ReturnType<typeof listWebhookRows>>[number],
  baseUrl: string,
): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenantId,
    token: row.token,
    sourceType: row.sourceType,
    url: `${baseUrl}/api/webhooks/${row.token}`,
    createdAt: row.createdAt,
  };
}

export function generateWebhookToken(): string {
  return randomBytes(24).toString('hex');
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export async function listWebhookEndpoints(tenantId: string, baseUrl: string) {
  const rows = await listWebhookRows(tenantId);
  return rows.map((r) => rowToWebhook(r, baseUrl));
}

export async function createWebhookEndpoint(
  tenantId: string,
  sourceType: 'github' | 'custom',
  baseUrl: string,
): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const token = generateWebhookToken();
  const secret = generateWebhookSecret();
  const row = await insertWebhook({ tenantId, token, secret, sourceType });
  return { endpoint: rowToWebhook(row, baseUrl), secret };
}

export async function deleteWebhookEndpoint(tenantId: string, id: string): Promise<boolean> {
  return deleteWebhookRow(tenantId, id);
}

export async function getWebhookByToken(token: string) {
  const row = await getWebhookByTokenRow(token);
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    token: row.token,
    secret: row.secret,
    sourceType: row.sourceType,
    createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
  };
}

export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = `sha256=${digest}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function verifyHmacSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function parseGithubEvent(
  payload: Record<string, unknown>,
  eventType?: string,
): Record<string, unknown> {
  const action = payload.action as string | undefined;
  const type = eventType?.trim() || 'unknown';
  const event = `github.${type}`;
  return {
    event,
    eventType: type,
    action,
    ...(action ? { eventAction: `${event}.${action}` } : {}),
    repository: (payload.repository as { full_name?: string })?.full_name,
    ...payload,
  };
}
