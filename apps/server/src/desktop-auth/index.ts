export { getOrCreateInstallId } from './install-id.js';
export { registerDesktopAuthRoutes } from './routes.js';
export {
  getPublicDesktopSession,
  startEntitlementsRefreshLoop,
  stopEntitlementsRefreshLoop,
  ENTITLEMENTS_INTERVAL_MS,
  ENTITLEMENTS_STALE_MS,
} from './service.js';
export { isPlatformAuthConfigured, getPlatformBaseUrl } from './platform-client.js';
