import type { KnowledgeReference } from '@veylin/db';
import { getRerankRuntime } from './reranker-service';

const MAX_DOC_CHARS = 512;

function scoreFromLogits(logits: ArrayLike<number>): number {
  if (logits.length === 1) return Number(logits[0] ?? 0);
  const a = Number(logits[0] ?? 0);
  const b = Number(logits[1] ?? 0);
  const max = Math.max(a, b);
  const ea = Math.exp(a - max);
  const eb = Math.exp(b - max);
  return eb / (ea + eb);
}

export async function rerankReferences(
  query: string,
  references: KnowledgeReference[],
  limit = 8,
): Promise<KnowledgeReference[]> {
  if (references.length <= limit) return references;
  const runtime = await getRerankRuntime();
  if (!runtime) return references.slice(0, limit);

  const scored: Array<{ ref: KnowledgeReference; score: number }> = [];
  for (const ref of references) {
    const inputs = await runtime.tokenizer(query, {
      text_pair: ref.text.slice(0, MAX_DOC_CHARS),
      padding: true,
      truncation: true,
    });
    const output = await runtime.model(inputs);
    scored.push({ ref, score: scoreFromLogits(output.logits.data) });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry.ref,
      refIndex: index + 1,
      score: entry.score,
    }));
}

export const __test__ = { scoreFromLogits };
