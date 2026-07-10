import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  hybridSearchChunks,
  insertChunk,
  insertDocument,
  listDocuments,
  listIndexingDocuments,
  deleteDocument,
  updateDocumentStatus,
  saveAgentCitation,
  getLatestAgentCitation,
  type KnowledgeReference,
} from '@veylin/db';
import { extractAndStoreGraph } from './rag-entities';
import { rerankReferences } from './rag-reranker';
import { embedTextsIfInstalled } from './embedding-service';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

const RAG_INGEST_INTERRUPTED_MESSAGE =
  'Indexing interrupted (server restarted or the worker stopped before completion)';

/** Mark documents stuck in `indexing` as failed after a restart. */
export async function sweepInterruptedRagIngests(): Promise<number> {
  const rows = await listIndexingDocuments();
  if (rows.length === 0) return 0;
  for (const doc of rows) {
    await updateDocumentStatus(doc.id, 'failed', RAG_INGEST_INTERRUPTED_MESSAGE);
  }
  return rows.length;
}

export type AgentCitationRecord = {
  query: string;
  references: KnowledgeReference[];
  at: number;
  threadId?: string | null;
};

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

function buildSearchContext(references: KnowledgeReference[]): string {
  const referenceList = references
    .map((r) => `- [${r.refIndex}] ${r.source} (chunk ${r.chunkId}, offset ${r.offset})`)
    .join('\n');
  const chunks = references
    .map((r) => `[${r.refIndex}] ${r.source} (offset ${r.offset})\n${r.text}`)
    .join('\n\n');
  return [
    '---Reference Document List---',
    referenceList,
    '',
    '---Document Chunks---',
    chunks,
    '',
    'When answering:',
    '- Synthesize in your own words; do not paste long verbatim excerpts.',
    '- Cite supporting facts with bracket numbers like [1] that match the Reference Document List.',
    '- End with a `### References` section listing only the references you actually used, one per line: `- [n] Document Title`.',
  ].join('\n');
}

export async function ingestDocumentText(
  tenantId: string,
  filename: string,
  text: string,
  mimeType?: string,
  options?: { model?: string },
): Promise<{ documentId: string; chunks: number; graphEntities: number; graphEdges: number }> {
  const doc = await insertDocument(tenantId, {
    filename,
    mimeType,
    sizeBytes: text.length,
  });
  await updateDocumentStatus(doc.id, 'indexing');
  try {
    const pieces = chunkText(text, filename);
    const storedChunks: Array<{ id: string; text: string }> = [];
    for (const piece of pieces) {
      const embeddings = await embedTextsIfInstalled([piece.text]);
      const embedding = embeddings?.[0] ?? null;
      const chunk = await insertChunk({
        documentId: doc.id,
        tenantId,
        text: piece.text,
        source: piece.source,
        offset: piece.offset,
        embedding: embedding ?? null,
      });
      storedChunks.push({ id: chunk.id, text: piece.text });
    }
    let graphEntities = 0;
    let graphEdges = 0;
    try {
      const graph = await extractAndStoreGraph(tenantId, doc.id, storedChunks, {
        model: options?.model,
      });
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
  options?: { recordAgentCitation?: boolean; threadId?: string | null },
): Promise<{ references: KnowledgeReference[]; context: string }> {
  let embedding: number[] | null = null;
  const embeddings = await embedTextsIfInstalled([query]);
  embedding = embeddings?.[0] ?? null;
  const candidates = await hybridSearchChunks(tenantId, query, embedding, 8);
  const references = await rerankReferences(query, candidates, 8);
  if (options?.recordAgentCitation) {
    await saveAgentCitation({
      tenantId,
      threadId: options.threadId ?? null,
      query,
      references,
    });
  }
  return { references, context: buildSearchContext(references) };
}

export async function getAgentCitations(
  tenantId: string,
  threadId?: string | null,
): Promise<AgentCitationRecord | null> {
  const row = await getLatestAgentCitation(tenantId, threadId);
  if (!row) return null;
  return {
    query: row.query,
    references: row.references,
    at: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
    threadId: row.threadId,
  };
}

export function buildKnowledgeSearchTool() {
  return createTool({
    id: 'knowledge_search',
    description:
      'Search the local knowledge base (uploaded documents). Returns numbered excerpts with source filenames for citation.',
    inputSchema: z.object({
      query: z.string().describe('Natural language search query'),
    }),
    outputSchema: z.object({
      references: z.array(
        z.object({
          refIndex: z.number(),
          chunkId: z.string(),
          documentId: z.string(),
          source: z.string(),
          text: z.string(),
          offset: z.number(),
          score: z.number().optional(),
        }),
      ),
      context: z.string(),
    }),
    execute: async (input, ctx?: { requestContext?: { get(key: string): unknown } }) => {
      const tenantId = ctx?.requestContext?.get('tenantId') as string | undefined;
      if (!tenantId) {
        return { references: [], context: '' };
      }
      const threadId = ctx?.requestContext?.get('threadId') as string | undefined;
      return searchKnowledge(tenantId, input.query, {
        recordAgentCitation: true,
        threadId: threadId ?? null,
      });
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

export async function buildKnowledgeContextBlock(tenantId: string): Promise<string> {
  let docs: Awaited<ReturnType<typeof listDocuments>>;
  try {
    docs = await listDocuments(tenantId);
  } catch {
    return '';
  }
  if (docs.length === 0) {
    return [
      '# Knowledge base (local)',
      'No documents are uploaded yet. The **知识库** panel is empty until the user adds files.',
      'Spreadsheet/table data in the **表格** panel is separate — use `table_sheets` (list) / `table_get`, not `knowledge_search`, for grid data.',
      'After documents are uploaded, call `knowledge_search` before answering document questions.',
    ].join('\n');
  }

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
    '- When the user\'s question could be answered by these documents, call `knowledge_search` BEFORE answering.',
    '- Use only the numbered excerpts returned by the tool. Cite them inline as [1], [2], etc.',
    '- Synthesize in your own words; do not paste long verbatim excerpts.',
    '- End with a `### References` section listing only the references you actually used: `- [n] Document Title`.',
    '- Re-run `knowledge_search` instead of relying on earlier retrieval results when the document set may have changed.',
    '- If no relevant excerpt exists, say so plainly rather than guessing.',
  ].join('\n');
}

export async function removeKnowledgeDocument(tenantId: string, documentId: string): Promise<boolean> {
  return deleteDocument(tenantId, documentId);
}
