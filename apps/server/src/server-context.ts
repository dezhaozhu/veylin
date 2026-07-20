import { isDesktopAuth } from './auth.js';
import { DEV_TENANT_ID } from './tenant.js';
import { getEnterprisePorts } from './ports/index.js';

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
    const membership = await ports.org.resolveTenant(
      session?.userId ?? 'dev-user',
      session?.displayName,
    );
    return {
      userId: session?.userId ?? 'dev-user',
      tenantId: membership.tenantId || DEV_TENANT_ID,
      role: membership.role,
      authed: false as boolean,
    };
  }

  const session = await ports.identity.getSession(headers);
  if (!session?.userId) {
    throw new UnauthorizedError();
  }
  const membership = await ports.org.resolveTenant(session.userId, session.displayName);
  return {
    userId: session.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    authed: true as boolean,
  };
}

export type RequestContext = Awaited<ReturnType<typeof resolveContext>>;
