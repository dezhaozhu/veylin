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
    // 本地数据归 installId,与数据目录同生共死;账号只是附加物,登出不动数据。
    const resourceOwnerId = session?.resourceOwnerId || getOrCreateInstallId();
    return {
      resourceOwnerId,
      accountId: session?.accountId ?? null,
      tenantId: DEV_TENANT_ID,
      role: 'owner' as const,
      authed: Boolean(session?.accountId),
    };
  }

  const session = await ports.identity.getSession(headers);
  if (!session?.resourceOwnerId) {
    throw new UnauthorizedError();
  }
  // 多用户部署:租户按**账号**解析(组织归属是人的属性,不是这台机器的属性);
  // 没有账号时退回资源归属,保证单机模式也能解析。
  const membership = await ports.org.resolveTenant(
    session.accountId ?? session.resourceOwnerId, session.displayName);
  return {
    resourceOwnerId: session.resourceOwnerId,
    accountId: session.accountId ?? null,
    tenantId: membership.tenantId,
    role: membership.role,
    authed: true as boolean,
  };
}

export type RequestContext = Awaited<ReturnType<typeof resolveContext>>;
