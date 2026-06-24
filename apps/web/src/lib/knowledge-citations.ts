export type KnowledgeCitation = {
  chunkId: string;
  documentId: string;
  source: string;
  text: string;
  offset: number;
  score?: number;
};

function isKnowledgeReference(value: unknown): value is KnowledgeCitation {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<KnowledgeCitation>;
  return (
    typeof r.chunkId === 'string' &&
    typeof r.documentId === 'string' &&
    typeof r.source === 'string' &&
    typeof r.text === 'string' &&
    typeof r.offset === 'number'
  );
}

function referencesFromOutput(output: unknown): KnowledgeCitation[] {
  if (!output || typeof output !== 'object') return [];
  const refs = (output as { references?: unknown }).references;
  if (!Array.isArray(refs)) return [];
  return refs.filter(isKnowledgeReference);
}

function isCompletedToolPart(part: {
  type?: string;
  toolName?: string;
  name?: string;
  state?: string;
}): boolean {
  if (part.state === 'output-available') return true;
  if (part.state === 'result') return true;
  return false;
}

function isKnowledgeSearchPart(part: {
  type?: string;
  toolName?: string;
  name?: string;
}): boolean {
  if (part.type === 'tool-knowledge_search') return true;
  const name = part.toolName ?? part.name;
  return part.type === 'tool-call' && name === 'knowledge_search';
}

function outputFromPart(part: {
  output?: unknown;
  result?: unknown;
}): unknown {
  return part.output ?? part.result;
}

/** Aggregate knowledge_search references from assistant message parts. */
export function extractKnowledgeCitations(parts: readonly unknown[] | undefined): KnowledgeCitation[] {
  if (!parts?.length) return [];

  const bySource = new Map<string, KnowledgeCitation>();

  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as {
      type?: string;
      toolName?: string;
      name?: string;
      state?: string;
      output?: unknown;
      result?: unknown;
    };

    if (!isKnowledgeSearchPart(part)) continue;
    if (!isCompletedToolPart(part)) continue;

    for (const ref of referencesFromOutput(outputFromPart(part))) {
      const prev = bySource.get(ref.source);
      if (!prev || (ref.score ?? 0) > (prev.score ?? 0)) {
        bySource.set(ref.source, ref);
      }
    }
  }

  return [...bySource.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
