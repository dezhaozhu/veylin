import type { FastifyInstance } from 'fastify';
import { PlatformApiError } from './platform-client.js';
import {
  getDesktopAuthStatus,
  getPublicDesktopSession,
  loadSessionForClient,
  loginWithPassword,
  logoutDesktopSession,
} from './service.js';
import { getOrCreateInstallId } from './install-id.js';

function sendPlatformError(
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  err: unknown,
) {
  if (err instanceof PlatformApiError) {
    return reply.code(err.status >= 400 && err.status < 600 ? err.status : 502).send({
      error: err.message,
      detail: err.body,
    });
  }
  const message = err instanceof Error ? err.message : 'desktop auth error';
  return reply.code(500).send({ error: message });
}

export function registerDesktopAuthRoutes(app: FastifyInstance): void {
  // Ensure install id exists as soon as routes load
  getOrCreateInstallId();

  app.get('/api/desktop-auth/status', async () => {
    return {
      ...getDesktopAuthStatus(),
      installId: getOrCreateInstallId(),
    };
  });

  app.get('/api/desktop-auth/session', async (_req, reply) => {
    try {
      return await loadSessionForClient();
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.post('/api/desktop-auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!username || !password) {
      return reply.code(400).send({ error: '请输入用户名和密码' });
    }
    try {
      const session = await loginWithPassword(username, password);
      return session;
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  app.post('/api/desktop-auth/logout', async (_req, reply) => {
    try {
      return await logoutDesktopSession();
    } catch (err) {
      return sendPlatformError(reply, err);
    }
  });

  /** Debug / ops: current public session without forcing entitlements refresh. */
  app.get('/api/desktop-auth/session-raw', async () => getPublicDesktopSession());
}
