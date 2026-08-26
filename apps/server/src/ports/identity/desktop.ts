import type { IdentityPort, IdentitySession, HeadersLike } from '../types.js';
import { DEV_TENANT_ID } from '../../tenant.js';
import { getOrCreateInstallId } from '../../desktop-auth/install-id.js';
import { readSessionFile } from '../../desktop-auth/session-store.js';

/**
 * Desktop identity:
 * - `userId` === installId (local thread resourceId; stable across login/logout)
 * - Platform account is attached when Host session has a logged-in user
 */
export function createDesktopIdentityPort(): IdentityPort {
  return {
    id: 'desktop',
    supportsLocalCredentials: false,
    async getSession(_headers: HeadersLike): Promise<IdentitySession | null> {
      const installId = getOrCreateInstallId();
      const file = readSessionFile();
      if (file.user) {
        return {
          resourceOwnerId: installId,
          displayName: file.user.display_name || file.user.username,
          email: file.user.email || undefined,
          accountId: String(file.user.id),
        };
      }
      return {
        resourceOwnerId: installId,
        displayName: '未登录',
        email: undefined,
        accountId: undefined,
      };
    },
  };
}

export { DEV_TENANT_ID };
