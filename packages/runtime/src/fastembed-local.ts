import { EmbeddingModel, FlagEmbedding } from '@mastra/fastembed';
import { embeddingCacheDir, isEmbeddingModelReady } from '@veylin/db';

let runtimePromise: Promise<FlagEmbedding> | null = null;

async function getFlagEmbedding(): Promise<FlagEmbedding> {
  runtimePromise ??= FlagEmbedding.init({
    model: EmbeddingModel.BGESmallENV15,
    cacheDir: embeddingCacheDir(),
    showDownloadProgress: false,
  });
  try {
    return await runtimePromise;
  } catch (err) {
    runtimePromise = null;
    throw err;
  }
}

export async function generateLocalEmbeddings(values: string[]): Promise<number[][]> {
  const model = await getFlagEmbedding();
  const stream = model.embed(values);
  const allResults: number[][] = [];
  for await (const batch of stream) {
    allResults.push(...batch.map((embedding) => Array.from(embedding)));
  }
  if (allResults.length === 0) {
    throw new Error('No embeddings generated');
  }
  return allResults;
}

/** AI SDK v3 embedder that reads models from VEYLIN_DATA_DIR/hf-embedding-cache. */
export const localFastembed = {
  specificationVersion: 'v3' as const,
  provider: 'fastembed',
  modelId: 'bge-small-en-v1.5',
  maxEmbeddingsPerCall: 256,
  supportsParallelCalls: true,
  async doEmbed({ values }: { values: string[] }) {
    const embeddings = await generateLocalEmbeddings(values);
    return { embeddings, warnings: [] as never[] };
  },
};

export function isLocalFastembedInstalled(): boolean {
  return isEmbeddingModelReady();
}

export function resetLocalFastembedRuntime(): void {
  runtimePromise = null;
}
