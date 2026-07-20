import type { MembershipRole, OrgDirectoryPort, OrgMembership } from '../types.js';
import { resolveTenantForUser, DEV_TENANT_ID } from '../../tenant.js';
import { listMembershipsByTenant } from '@veylin/db';

const READ_HINT = /^(get_|list_|search_|find_|read_|query_|fetch_|describe_|count_)/i;
const WRITE_HINT = /^(create_|update_|delete_|remove_|write_|set_|put_|post_|patch_|mutate_)/i;

/**
 * Default org directory: one personal tenant per user (existing resolveTenantForUser).
 * Role-based tool filter: members can be restricted to read-like tools when
 * VEYLIN_RBAC_FILTER_TOOLS=1 (P1); owners/admins unrestricted.
 */
export function createPersonalOrgDirectoryPort(): OrgDirectoryPort {
  const filterEnabled = process.env.VEYLIN_RBAC_FILTER_TOOLS === '1';

  return {
    id: 'personal-tenant',
    async resolveTenant(userId: string, displayName?: string): Promise<OrgMembership> {
      if (userId === 'dev-user') {
        return { tenantId: DEV_TENANT_ID, role: 'owner' };
      }
      const tenantId = await resolveTenantForUser(userId, displayName);
      // Prefer membership role when available
      try {
        const { findMembershipByUser } = await import('@veylin/db');
        const m = await findMembershipByUser(userId);
        if (m && m.tenantId === tenantId) {
          return { tenantId, role: m.role };
        }
      } catch {
        // fall through
      }
      return { tenantId, role: 'owner' };
    },
    async listMembers(tenantId: string) {
      try {
        const rows = await listMembershipsByTenant(tenantId);
        return rows.map((r) => ({ userId: r.userId, role: r.role }));
      } catch {
        return [];
      }
    },
    allowedToolsForRole(role: MembershipRole, allToolIds: string[]): string[] | null {
      if (!filterEnabled) return null;
      if (role === 'owner' || role === 'admin') return null;
      // members: prefer read-like tools; if none match hints, allow all (avoid locking out)
      const readIds = allToolIds.filter((id) => {
        const leaf = id.includes('__') ? id.split('__').pop()! : id;
        return READ_HINT.test(leaf) && !WRITE_HINT.test(leaf);
      });
      return readIds.length > 0 ? readIds : null;
    },
  };
}
