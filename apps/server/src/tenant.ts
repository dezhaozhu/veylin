import {
  findTenantById,
  upsertTenant,
  findMembershipByUser,
  createMembership,
  createTenant,
} from '@veylin/db';

/** Fixed tenant id used when no authenticated session is present (dev / desktop mode). */
export const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/** Ensure the dev tenant row exists so FK-bound rows (agents) can be created. */
export async function ensureDevTenant(): Promise<void> {
  try {
    const existing = await findTenantById(DEV_TENANT_ID);
    if (!existing) {
      await upsertTenant({ id: DEV_TENANT_ID, name: 'Dev Tenant' });
    }
  } catch (err) {
    // Tolerated during first-boot races, but log so a persistent failure is visible.
    console.warn('[tenant] ensureDevTenant failed:', err);
  }
}

/**
 * Resolve the tenant for an authenticated user via membership. On first login a
 * personal tenant + owner membership is created. Best-effort: falls back to the
 * user id so a failure never blocks chat.
 */
export async function resolveTenantForUser(userId: string, name?: string): Promise<string> {
  try {
    const membership = await findMembershipByUser(userId);
    if (membership) return membership.tenantId;

    const tenant = await createTenant(name ? `${name}'s workspace` : 'Workspace');
    await createMembership({ userId, tenantId: tenant.id, role: 'owner' });
    return tenant.id;
  } catch {
    return userId;
  }
}
