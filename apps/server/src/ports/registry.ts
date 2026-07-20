import { isDesktopAuth, getAuth } from '../auth.js';
import type { EnterprisePorts } from './types.js';
import { createDesktopIdentityPort } from './identity/desktop.js';
import { createLocalPasswordIdentityPort } from './identity/local-password.js';
import { createWebhookIdentityPort } from './identity/webhook.js';
import { createOidcIdentityPort } from './identity/oidc.js';
import { createPersonalOrgDirectoryPort } from './org/personal-tenant.js';
import { createMcpBusinessSourcePort } from './business-source/mcp-adapter.js';
import { createLocalAuditPort } from './audit/local.js';

let cached: EnterprisePorts | null = null;

function resolveIdentityProvider(): string {
  if (isDesktopAuth) return 'desktop';
  return (process.env.IDENTITY_PROVIDER?.trim() || 'local').toLowerCase();
}

export function getEnterprisePorts(): EnterprisePorts {
  if (cached) return cached;

  const provider = resolveIdentityProvider();
  const identity =
    provider === 'desktop'
      ? createDesktopIdentityPort()
      : provider === 'webhook'
        ? createWebhookIdentityPort()
        : provider === 'oidc'
          ? createOidcIdentityPort()
          : createLocalPasswordIdentityPort(getAuth);

  cached = {
    identity,
    org: createPersonalOrgDirectoryPort(),
    businessSource: createMcpBusinessSourcePort(),
    audit: createLocalAuditPort(),
  };
  console.info(
    `[ports] identity=${cached.identity.id} org=${cached.org.id} businessSource=${cached.businessSource.id} audit=${cached.audit.id}`,
  );
  return cached;
}

/** Test helper / hot-reload. */
export function resetEnterprisePorts(): void {
  cached = null;
}

export type { EnterprisePorts } from './types.js';
