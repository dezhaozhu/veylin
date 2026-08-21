import { isDesktopAuth } from './auth.js';
import { DEV_TENANT_ID } from './tenant.js';
import { getEnterprisePorts } from './ports/index.js';
import { getOrCreateInstallId } from './desktop-auth/install-id.js';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export function isForbiddenError(err: unknown): boolean {
  return err instanceof Error && err.message === 'forbidden';
}

export async function resolveContext(headers: Record<string, string | string[] | undefined>) {
  const ports = getEnterprisePorts();

  if (isDesktopAuth || ports.identity.id === 'desktop') {
    const session = await ports.identity.getSession(headers);
    // Local threads key off installId (resourceId === userId). Keep desktop on DEV_TENANT.
    const installId = session?.userId || getOrCreateInstallId();
    return {
      userId: installId,
      installId,
      platformUserId: session?.platformUserId ?? null,
      tenantId: DEV_TENANT_ID,
      role: 'owner' as const,
      authed: Boolean(session?.platformUserId),
    };
  }

  const session = await ports.identity.getSession(headers);
  if (!session?.userId) {
    throw new UnauthorizedError();
  }
  const membership = await ports.org.resolveTenant(session.userId, session.displayName);
  return {
    userId: session.userId,
    installId: null as string | null,
    platformUserId: session.platformUserId ?? null,
    tenantId: membership.tenantId,
    role: membership.role,
    authed: true as boolean,
  };
}

export type RequestContext = Awaited<ReturnType<typeof resolveContext>>;
