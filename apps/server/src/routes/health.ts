import type { FastifyInstance } from 'fastify';
import { getDb } from '@veylin/db';
import { getEmbeddingStatus } from '../embedding-service.js';
import type { ServerDeps } from './types.js';

/** Set after the first successful DB probe so high-frequency /health polls stay cheap. */
let dbHealthVerified = false;

export function resetDbHealthCacheForTests(): void {
  dbHealthVerified = false;
}

export function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/health', async (_req, reply) => {
    const embedding = await getEmbeddingStatus();

    if (dbHealthVerified) {
      return {
        ok: true,
        db: { ready: true },
        embedding: {
          ready: embedding.installed,
          phase: embedding.download.phase,
        },
      };
    }

    let dbReady = true;
    try {
      await getDb().query('RETURN 1');
      await getDb().query('SELECT thread_id FROM thread_state LIMIT 1');
      dbHealthVerified = true;
    } catch (err) {
      dbReady = false;
      app.log.warn({ err }, 'database health probe failed');
    }
    if (!dbReady) {
      return reply.status(503).send({
        ok: false,
        db: { ready: false },
        embedding: {
          ready: embedding.installed,
          phase: embedding.download.phase,
        },
      });
    }
    return {
      ok: true,
      db: { ready: true },
      embedding: {
        ready: embedding.installed,
        phase: embedding.download.phase,
      },
    };
  });

  // Agent picker source for the UI.
  app.get('/api/agents', async () => ({ agents: deps.runtime.listAgents() }));
}
