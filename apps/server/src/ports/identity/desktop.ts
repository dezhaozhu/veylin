import type { IdentityPort, IdentitySession, HeadersLike } from '../types.js';
import { DEV_TENANT_ID } from '../../tenant.js';

/** Desktop / skip-auth: fixed local user, no credentials UI. */
export function createDesktopIdentityPort(): IdentityPort {
  return {
    id: 'desktop',
    supportsLocalCredentials: false,
    async getSession(_headers: HeadersLike): Promise<IdentitySession | null> {
      return {
        userId: 'dev-user',
        displayName: 'Dev User',
        email: undefined,
      };
    },
  };
}

export { DEV_TENANT_ID };
