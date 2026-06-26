import { createTool } from '@mastra/core/tools';
import { embedMany } from 'ai';
import { z } from 'zod';
import { fastembed } from '@mastra/fastembed';
import {
  hybridSearchChunks,
  insertChunk,
  insertDocument,
  listDocuments,
  deleteDocument,
  updateDocumentStatus,
  type KnowledgeReference,
} from '@veylin/db';
import { extractAndStoreGraph } from './rag-entities';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

let lastReferencesByTenant = new Map<string, KnowledgeReference[]>();

export function getLastKnowledgeReferences(tenantId: string): KnowledgeReference[] {
  return lastReferencesByTenant.get(tenantId) ?? [];
}

function chunkText(text: string, source: string): { text: string; source: string; offset: number }[] {
  const out: { text: string; source: string; offset: number }[] = [];
  let offset = 0;
  while (offset < text.length) {
    const slice = text.slice(offset, offset + CHUNK_SIZE);
    if (slice.trim()) out.push({ text: slice, source, offset });
    offset += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return out;
}

export async function ingestDocumentText(
  tenantId: string,
  filename: string,
  text: string,
  mimeType?: string,
): Promise<{ documentId: string; chunks: number; graphEntities: number; graphEdges: number }> {
  const doc = await insertDocument(tenantId, {
    filename,
    mimeType,
    sizeBytes: text.length,
  });
  await updateDocumentStatus(doc.id, 'indexing');
  try {
    const pieces = chunkText(text, filename);
    for (const piece of pieces) {
      const { embeddings } = await embedMany({ model: fastembed, values: [piece.text] });
      const embedding = embeddings[0] ?? null;
      await insertChunk({
        documentId: doc.id,
        tenantId,
        text: piece.text,
        source: piece.source,
        offset: piece.offset,
        embedding: embedding ?? null,
      });
    }
    let graphEntities = 0;
    let graphEdges = 0;
    try {
      const graph = await extractAndStoreGraph(tenantId, doc.id, text);
      graphEntities = graph.entities;
      graphEdges = graph.edges;
    } catch (graphErr) {
      console.warn('[rag] graph extraction failed:', graphErr);
    }
    await updateDocumentStatus(doc.id, 'ready');
    return { documentId: doc.id, chunks: pieces.length, graphEntities, graphEdges };
  } catch (err) {
    await updateDocumentStatus(doc.id, 'failed', String(err));
    throw err;
  }
}

export async function searchKnowledge(
  tenantId: string,
  query: string,
): Promise<{ references: KnowledgeReference[]; context: string }> {
  let embedding: number[] | null = null;
  try {
    const { embeddings } = await embedMany({ model: fastembed, values: [query] });
    embedding = embeddings[0] ?? null;
  } catch {
    embedding = null;
  }
  const references = await hybridSearchChunks(tenantId, query, embedding, 8);
  lastReferencesByTenant.set(tenantId, references);
  const context = references
    .map((r, i) => `[${i + 1}] ${r.source} (offset ${r.offset})\n${r.text}`)
    .join('\n\n');
  return { references, context };
}

export function buildKnowledgeSearchTool() {
  return createTool({
    id: 'knowledge_search',
    description:
      'Search the local knowledge base (uploaded documents). Returns relevant excerpts with source filenames for citation.',
    inputSchema: z.object({
      query: z.string().describe('Natural language search query'),
    }),
    outputSchema: z.object({
      references: z.array(
        z.object({
          chunkId: z.string(),
          documentId: z.string(),
          source: z.string(),
          text: z.string(),
          offset: z.number(),
        }),
      ),
      context: z.string(),
    }),
    execute: async (input, ctx?: { requestContext?: { get(key: string): unknown } }) => {
      const tenantId = ctx?.requestContext?.get('tenantId') as string | undefined;
      if (!tenantId) {
        return { references: [], context: '' };
      }
      const result = await searchKnowledge(tenantId, input.query);
      return result;
    },
  });
}

export async function listKnowledgeDocuments(tenantId: string) {
  return listDocuments(tenantId);
}

const KNOWLEDGE_BLOCK_DOC_LIMIT = 40;

const DOC_STATUS_LABEL: Record<string, string> = {
  ready: 'ready',
  indexing: 'indexing',
  pending: 'pending',
  failed: 'failed',
};

/**
 * Live knowledge-base status injected into the system message each turn. Lets the
 * model know which uploaded documents currently exist (reflecting panel uploads/
 * deletes immediately) and nudges it to call `knowledge_search` before answering
 * questions the documents could cover. Returns '' when the base is empty so we
 * never spend tokens advertising an empty store or prompting an empty search.
 */
export async function buildKnowledgeContextBlock(tenantId: string): Promise<string> {
  let docs: Awaited<ReturnType<typeof listDocuments>>;
  try {
    docs = await listDocuments(tenantId);
  } catch {
    return '';
  }
  if (docs.length === 0) return '';

  const readyCount = docs.filter((d) => d.status === 'ready').length;
  const shown = docs.slice(0, KNOWLEDGE_BLOCK_DOC_LIMIT);
  const lines = shown.map((d) => `- ${d.filename} [${DOC_STATUS_LABEL[d.status] ?? d.status}]`);
  const more = docs.length - shown.length;
  if (more > 0) lines.push(`- ...and ${more} more document(s)`);

  return [
    '# Knowledge base (local, live snapshot)',
    `The user maintains a local knowledge base of uploaded documents, searchable with the \`knowledge_search\` tool. It currently holds ${docs.length} document(s) (${readyCount} indexed and searchable):`,
    lines.join('\n'),
    'Guidance:',
    '- When the user\'s question could be answered by these documents (manuals, SOPs, specs, regulations, internal notes, prior records), call `knowledge_search` BEFORE answering, then cite the source filename(s).',
    '- This list is the current state at this moment; documents may have been added or removed since earlier in the conversation. Re-run `knowledge_search` instead of relying on earlier retrieval results.',
    '- Only `ready` documents are searchable. If the base has no relevant excerpt, say so plainly rather than guessing.',
  ].join('\n');
}

export async function removeKnowledgeDocument(tenantId: string, documentId: string): Promise<boolean> {
  return deleteDocument(tenantId, documentId);
}
