export type KnowledgeCitation = {
  refIndex: number;
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
    typeof r.offset === 'number' &&
    (typeof r.refIndex === 'number' || r.refIndex === undefined)
  );
}

function referencesFromOutput(output: unknown): KnowledgeCitation[] {
  if (!output || typeof output !== 'object') return [];
  const refs = (output as { references?: unknown }).references;
  if (!Array.isArray(refs)) return [];
  return refs
    .filter(isKnowledgeReference)
    .map((ref, index) => ({
      ...ref,
      refIndex: ref.refIndex ?? index + 1,
    }));
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

  const byChunk = new Map<string, KnowledgeCitation>();

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
      const prev = byChunk.get(ref.chunkId);
      if (!prev || (ref.score ?? 0) > (prev.score ?? 0)) {
        byChunk.set(ref.chunkId, ref);
      }
    }
  }

  return [...byChunk.values()].sort((a, b) => a.refIndex - b.refIndex);
}

export function extractAssistantText(parts: readonly unknown[] | undefined): string {
  if (!parts?.length) return '';
  const chunks: string[] = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as { type?: string; text?: string };
    if (part.type === 'text' && part.text) chunks.push(part.text);
  }
  return chunks.join('\n');
}

export function filterCitationsUsedInAnswer(
  citations: KnowledgeCitation[],
  answerText: string,
): KnowledgeCitation[] {
  const used = new Set<number>();
  for (const match of answerText.matchAll(/\[(\d{1,2})\]/g)) {
    const index = Number(match[1]);
    if (index > 0) used.add(index);
  }
  if (used.size === 0) return citations;
  const filtered = citations.filter((c) => used.has(c.refIndex));
  return filtered.length > 0 ? filtered : citations;
}

export function citationSnippetPreview(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}
