import { DEFAULT_MODEL, getModelConfig } from '@veylin/runtime';
import {
  insertRelates,
  linkChunkEntity,
  normalizeEntityKey,
  upsertEntity,
} from '@veylin/db';
import { applyTenantModelSettings } from './model-settings-store';

type ExtractedEntity = { name: string; type: string; description?: string };
type ExtractedEdge = { from: string; to: string; relation: string };

const MAX_GRAPH_CHUNKS = 24;
const MIN_CHUNK_CHARS = 80;

const ENTITY_EXTRACTION_PROMPT = `You are a knowledge graph specialist. Extract entities and relationships from the input text chunk.

Rules:
- Only include entity names that literally appear in the text.
- Use types such as person, organization, place, concept, product, event, term, section, date, or Other.
- Provide a concise entity_description grounded only in the text.
- Extract clear binary relationships between entities mentioned in this chunk.
- Max 8 entities and 6 relationships for this chunk.
- Write entity names in a consistent title case when case-insensitive.
- Return strict JSON:
{"entities":[{"name":"...","type":"...","description":"..."}],"edges":[{"from":"...","to":"...","relation":"..."}]}`;

function sampleChunksForGraph<T extends { text: string }>(chunks: T[]): T[] {
  if (chunks.length <= MAX_GRAPH_CHUNKS) return chunks;
  const step = chunks.length / MAX_GRAPH_CHUNKS;
  const sampled: T[] = [];
  for (let i = 0; i < MAX_GRAPH_CHUNKS; i++) {
    const item = chunks[Math.floor(i * step)];
    if (item) sampled.push(item);
  }
  return sampled;
}

async function llmExtractChunk(
  tenantId: string,
  text: string,
  modelKey: string,
): Promise<{ entities: ExtractedEntity[]; edges: ExtractedEdge[] } | null> {
  await applyTenantModelSettings(tenantId);
  const cfg = getModelConfig(modelKey || DEFAULT_MODEL);
  if (!cfg.apiKey) return null;
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.modelId,
        messages: [
          { role: 'system', content: ENTITY_EXTRACTION_PROMPT },
          { role: 'user', content: text.slice(0, 4000) },
        ],
        temperature: 0,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      entities?: Array<{ name?: string; type?: string; description?: string }>;
      edges?: ExtractedEdge[];
    };
    const entities = (parsed.entities ?? [])
      .filter((e) => e.name?.trim() && text.includes(e.name.trim()))
      .slice(0, 8)
      .map((e) => ({
        name: e.name!.trim(),
        type: e.type?.trim() || 'concept',
        description: e.description?.trim() || undefined,
      }));
    if (entities.length === 0) return null;
    const names = new Set(entities.map((e) => e.name));
    const edges = (parsed.edges ?? [])
      .filter((e) => names.has(e.from) && names.has(e.to) && e.relation)
      .slice(0, 6);
    return { entities, edges };
  } catch {
    return null;
  }
}

export async function extractAndStoreGraph(
  tenantId: string,
  threadId: string,
  documentId: string,
  chunks: Array<{ id: string; text: string }>,
  options?: { model?: string },
): Promise<{ entities: number; edges: number }> {
  const modelKey = options?.model?.trim() || DEFAULT_MODEL;
  const eligible = sampleChunksForGraph(
    chunks.filter((c) => c.text.trim().length >= MIN_CHUNK_CHARS),
  );
  if (eligible.length === 0) return { entities: 0, edges: 0 };

  const nameToId = new Map<string, string>();
  const edgeKeys = new Set<string>();
  let edgeCount = 0;

  for (const chunk of eligible) {
    const extracted = await llmExtractChunk(tenantId, chunk.text, modelKey);
    if (!extracted) continue;

    const chunkEntityNames: string[] = [];
    for (const ent of extracted.entities) {
      const key = normalizeEntityKey(ent.name);
      const row = await upsertEntity({
        tenantId,
        threadId,
        name: ent.name,
        type: ent.type || 'concept',
        description: ent.description,
        documentId,
      });
      nameToId.set(key, row.id);
      chunkEntityNames.push(key);
      await linkChunkEntity({
        tenantId,
        documentId,
        chunkId: chunk.id,
        entityId: row.id,
      });
    }

    for (const edge of extracted.edges) {
      const fromKey = normalizeEntityKey(edge.from);
      const toKey = normalizeEntityKey(edge.to);
      const fromId = nameToId.get(fromKey);
      const toId = nameToId.get(toKey);
      if (!fromId || !toId || fromId === toId) continue;
      const relation = edge.relation.trim() || 'related_to';
      const edgeKey = `${fromId}|${toId}|${relation}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      await insertRelates({
        tenantId,
        fromEntityId: fromId,
        toEntityId: toId,
        relation,
        documentId,
      });
      edgeCount += 1;
    }

    void chunkEntityNames;
  }

  return { entities: nameToId.size, edges: edgeCount };
}

export const __test__ = { sampleChunksForGraph, normalizeEntityKey };
