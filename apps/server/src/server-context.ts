import { auth, isDesktopAuth } from './auth.js';
import { resolveTenantForUser, DEV_TENANT_ID } from './tenant.js';

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
  if (isDesktopAuth) {
    return { userId: 'dev-user', tenantId: DEV_TENANT_ID, authed: false };
  }
  try {
    const session = await auth.api.getSession({ headers: headers as never });
    if (session?.user) {
      const tenantId = await resolveTenantForUser(session.user.id, session.user.name ?? undefined);
      return { userId: session.user.id, tenantId, authed: true };
    }
  } catch {
    throw new UnauthorizedError();
  }
  throw new UnauthorizedError();
}

export type RequestContext = Awaited<ReturnType<typeof resolveContext>>;
