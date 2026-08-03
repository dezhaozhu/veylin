import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getViewer3dState,
  onViewer3dEvent,
  setViewer3dModel,
  setViewer3dOverlay,
  setViewer3dSelection,
  type Viewer3dEvent,
} from '../viewer3d-store.js';
import type { ServerDeps } from './types.js';

const selectionBodySchema = z.object({
  faceIds: z.array(z.number()),
});

const modelBodySchema = z.object({
  meshUrl: z.string(),
  title: z.string().optional(),
  modelId: z.string().optional(),
});

const overlayBodySchema = z.object({
  overlayUrl: z.string().nullable(),
});

export function registerViewer3dRoutes(app: FastifyInstance, deps: ServerDeps): void {
  // Right-panel 3D viewer state (model + result overlay + user face selection).
  app.get('/api/viewer3d', async (req) => {
    await deps.resolveContext(req.headers);
    return getViewer3dState();
  });

  // Server-Sent Events: push viewer3d change events so the client can resync on
  // modelReplace/overlayUpdate/selectionChange (mirrors /api/table/stream).
  app.get('/api/viewer3d/stream', async (req, reply) => {
    await deps.resolveContext(req.headers);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('retry: 3000\n\n');
    const send = (event: Viewer3dEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = onViewer3dEvent(send);
    const keepAlive = setInterval(() => raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post('/api/viewer3d/selection', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const parsed = selectionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    setViewer3dSelection(parsed.data.faceIds);
    return { ok: true, state: getViewer3dState() };
  });

  app.put('/api/viewer3d/model', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const parsed = modelBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    setViewer3dModel(parsed.data);
    return { ok: true, state: getViewer3dState() };
  });

  app.put('/api/viewer3d/overlay', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const parsed = overlayBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, message: parsed.error.message };
    }
    setViewer3dOverlay(parsed.data.overlayUrl);
    return { ok: true, state: getViewer3dState() };
  });
}
