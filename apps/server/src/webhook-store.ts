import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  deleteWebhookRow,
  getWebhookBySourceRow,
  insertWebhook,
  listWebhookRows,
  updateWebhookRow,
} from '@veylin/db';
import type { WebhookCreateInput, WebhookEndpoint, WebhookUpdateInput } from '@veylin/shared';
import { extractEventKey } from './webhook-filter';

function buildWebhookUrl(baseUrl: string, tenantId: string, source: string): string {
  return `${baseUrl}/api/events/${tenantId}/${source}`;
}

function rowToWebhook(
  row: Awaited<ReturnType<typeof listWebhookRows>>[number],
  baseUrl: string,
): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    source: row.source,
    url: buildWebhookUrl(baseUrl, row.tenantId, row.source),
    eventKeyExpr: row.eventKeyExpr,
    signatureHeader: row.signatureHeader,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export async function listWebhookEndpoints(tenantId: string, baseUrl: string) {
  const rows = await listWebhookRows(tenantId);
  return rows.map((r) => rowToWebhook(r, baseUrl));
}

export async function createWebhookEndpoint(
  tenantId: string,
  input: WebhookCreateInput,
  baseUrl: string,
): Promise<{ endpoint: WebhookEndpoint; secret: string | null }> {
  const secret = input.webhookSecret ?? generateWebhookSecret();
  const row = await insertWebhook({
    tenantId,
    name: input.name,
    source: input.source,
    secret,
    eventKeyExpr: input.eventKeyExpr,
    signatureHeader: input.signatureHeader,
    enabled: true,
  });
  return {
    endpoint: rowToWebhook(row, baseUrl),
    secret: input.webhookSecret ? null : secret,
  };
}

export async function createGithubWebhookEndpoint(
  tenantId: string,
  baseUrl: string,
  name = 'GitHub',
): Promise<{ endpoint: WebhookEndpoint; secret: string | null }> {
  const existing = await getWebhookBySourceRow(tenantId, 'github');
  if (existing) {
    return {
      endpoint: rowToWebhook(existing, baseUrl),
      secret: null,
    };
  }
  const row = await insertWebhook({
    tenantId,
    name,
    source: 'github',
    secret: generateWebhookSecret(),
    eventKeyExpr: 'type',
    signatureHeader: 'X-Hub-Signature-256',
    enabled: true,
  });
  return { endpoint: rowToWebhook(row, baseUrl), secret: row.secret };
}

export async function deleteWebhookEndpoint(tenantId: string, id: string): Promise<boolean> {
  return deleteWebhookRow(tenantId, id);
}

export async function updateWebhookEndpoint(
  tenantId: string,
  id: string,
  input: WebhookUpdateInput,
  baseUrl: string,
): Promise<WebhookEndpoint | null> {
  const row = await updateWebhookRow(tenantId, id, input);
  return row ? rowToWebhook(row, baseUrl) : null;
}

export async function getWebhookConfig(tenantId: string, source: string) {
  const row = await getWebhookBySourceRow(tenantId, source);
  if (!row || !row.enabled) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    source: row.source,
    secret: row.secret,
    eventKeyExpr: row.eventKeyExpr,
    signatureHeader: row.signatureHeader,
  };
}

/** OpenHands-compatible HMAC verification (supports `sha256=` prefix or raw hex). */
export function verifyWebhookSignature(
  payload: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const normalized = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(normalized));
  } catch {
    return false;
  }
}

export function parseGithubEventKey(
  payload: Record<string, unknown>,
  eventType?: string,
): string {
  const type = eventType?.trim() || 'unknown';
  const action = payload.action as string | undefined;
  if (action) return `${type}.${action}`;
  return type;
}

export function resolveEventKey(
  source: string,
  payload: Record<string, unknown>,
  eventKeyExpr: string,
  githubEventType?: string,
): string {
  if (source === 'github') {
    return parseGithubEventKey(payload, githubEventType);
  }
  return extractEventKey(eventKeyExpr, payload);
}

export function buildEventContext(
  source: string,
  eventKey: string,
  payload: Record<string, unknown>,
  githubEventType?: string,
): Record<string, unknown> {
  if (source === 'github') {
    const type = githubEventType?.trim() || 'unknown';
    const action = payload.action as string | undefined;
    return {
      source,
      eventKey,
      event: eventKey,
      eventType: type,
      action,
      ...(action ? { eventAction: `${type}.${action}` } : {}),
      repository: (payload.repository as { full_name?: string })?.full_name,
      ...payload,
    };
  }
  return {
    source,
    eventKey,
    event: eventKey,
    ...payload,
  };
}
