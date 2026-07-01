import type { FastifyInstance } from 'fastify';
import { SUBAGENT_QUEUE, type SubagentJob } from '../queue.js';
import { applyTenantModelSettings } from '../model-settings-store.js';
import {
  ingestDocumentText,
  getAgentCitations,
  listKnowledgeDocuments,
  removeKnowledgeDocument,
  searchKnowledge,
} from '../rag-store.js';
import { extractPdfText } from '../extract-pdf-text.js';
import { RAG_UPLOAD_MAX_BYTES } from '../rag-limits.js';
import {
  getLocalModelsStatus,
  downloadLocalModel,
  removeLocalModel,
  updateLocalModel,
  type LocalModelId,
} from '../local-models-service.js';
import { listGraphForTenant, getChunksForEntity } from '@veylin/db';
import type { ServerDeps } from './types.js';

export function registerRagRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/api/rag/documents', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const documents = await listKnowledgeDocuments(ctx.tenantId);
    return { documents };
  });

  app.post('/api/rag/extract-pdf', async (req, reply) => {
    await deps.resolveContext(req.headers);
    const buffer = req.body as Buffer | undefined;
    if (!buffer?.length) {
      reply.code(400);
      return { ok: false, message: 'empty body' };
    }
    if (buffer.length > RAG_UPLOAD_MAX_BYTES) {
      reply.code(413);
      return { ok: false, message: `PDF exceeds ${RAG_UPLOAD_MAX_BYTES} byte upload limit` };
    }
    try {
      const text = await extractPdfText(new Uint8Array(buffer));
      return { ok: true, text };
    } catch (err) {
      reply.code(422);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/rag/documents', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = req.body as { filename: string; text: string; mimeType?: string; model?: string };
    const textBytes = Buffer.byteLength(body.text ?? '', 'utf8');
    if (textBytes > RAG_UPLOAD_MAX_BYTES) {
      reply.code(413);
      return { ok: false, message: `document text exceeds ${RAG_UPLOAD_MAX_BYTES} byte upload limit` };
    }
    await applyTenantModelSettings(ctx.tenantId);
    const result = await ingestDocumentText(
      ctx.tenantId,
      body.filename,
      body.text,
      body.mimeType,
      { model: body.model?.trim() || 'default' },
    );
    return { ok: true, ...result };
  });

  app.delete('/api/rag/documents/:id', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const id = (req.params as { id: string }).id;
    const ok = await removeKnowledgeDocument(ctx.tenantId, id);
    if (!ok) {
      reply.code(404);
      return { ok: false, message: 'document not found' };
    }
    return { ok: true };
  });

  app.get('/api/rag/references', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { threadId } = req.query as { threadId?: string };
    const record = await getAgentCitations(ctx.tenantId, threadId ?? null);
    return {
      query: record?.query ?? null,
      references: record?.references ?? [],
      at: record?.at ?? null,
      threadId: record?.threadId ?? null,
    };
  });

  app.post('/api/rag/search', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const body = (req.body ?? {}) as { query?: string };
    const query = body.query?.trim();
    if (!query) {
      reply.code(400);
      return { ok: false, message: 'query is required' };
    }
    const result = await searchKnowledge(ctx.tenantId, query);
    return { ok: true, ...result };
  });

  app.get('/api/rag/local-models', async () => getLocalModelsStatus());

  app.post('/api/rag/local-models/:id/download', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (id !== 'embedding' && id !== 'reranker') {
      reply.code(404);
      return { ok: false, message: 'unknown model' };
    }
    const result = downloadLocalModel(id as LocalModelId);
    if (!result.ok) {
      reply.code(400);
      return { ok: false, message: result.message };
    }
    return { ok: true, ...(await getLocalModelsStatus()) };
  });

  app.delete('/api/rag/local-models/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (id !== 'embedding' && id !== 'reranker') {
      reply.code(404);
      return { ok: false, message: 'unknown model' };
    }
    try {
      await removeLocalModel(id as LocalModelId);
      return { ok: true, ...(await getLocalModelsStatus()) };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.put('/api/rag/local-models/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (id !== 'embedding' && id !== 'reranker') {
      reply.code(404);
      return { ok: false, message: 'unknown model' };
    }
    const body = (req.body ?? {}) as { enabled?: boolean };
    try {
      const status = await updateLocalModel(id as LocalModelId, body);
      return { ok: true, ...status };
    } catch (err) {
      reply.code(400);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get('/api/kg', async (req) => {
    const ctx = await deps.resolveContext(req.headers);
    const { documentId } = req.query as { documentId?: string };
    const graph = await listGraphForTenant(ctx.tenantId, {
      documentId: documentId?.trim() || undefined,
    });
    return {
      entities: graph.entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        description: e.description ?? null,
        documentId: e.documentId ?? null,
      })),
      edges: graph.edges.map((e) => ({
        source: e.fromEntityId,
        target: e.toEntityId,
        relation: e.relation,
      })),
    };
  });

  app.get('/api/kg/entities/:entityId/chunks', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const { entityId } = req.params as { entityId: string };
    const chunks = await getChunksForEntity(ctx.tenantId, entityId, 8);
    if (chunks.length === 0) {
      reply.code(404);
      return { ok: false, chunks: [] };
    }
    return {
      ok: true,
      chunks: chunks.map((c) => ({
        chunkId: c.id,
        documentId: c.documentId,
        source: c.source,
        text: c.text,
        offset: c.offset,
      })),
    };
  });

  app.post('/api/subagent', async (req, reply) => {
    const ctx = await deps.resolveContext(req.headers);
    const job = req.body as SubagentJob;
    if (job.tenantId !== ctx.tenantId) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    const id = await deps.queue.send(SUBAGENT_QUEUE, job);
    return { ok: true, jobId: id };
  });
}
