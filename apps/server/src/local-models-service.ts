import { getEmbeddingStatus, startEmbeddingDownload, removeEmbeddingModel } from './embedding-service';
import { resolveHuggingfaceEndpoint } from './hf-endpoint';
import {
  getRerankerStatus,
  setRerankerEnabled,
  startRerankerDownload,
  removeRerankerModel,
} from './reranker-service';

export type LocalModelId = 'embedding' | 'reranker';

export type LocalModelStatus =
  | (Awaited<ReturnType<typeof getEmbeddingStatus>> & { enabled?: undefined })
  | (Awaited<ReturnType<typeof getRerankerStatus>> & {
      id: 'reranker';
      kind: 'reranker';
      required: false;
    });

export async function getLocalModelsStatus(): Promise<{
  hfEndpoint: string | null;
  models: LocalModelStatus[];
}> {
  const [embedding, reranker, hfEndpoint] = await Promise.all([
    getEmbeddingStatus(),
    getRerankerStatus(),
    resolveHuggingfaceEndpoint().catch(() => null),
  ]);
  return {
    hfEndpoint,
    models: [
      embedding,
      {
        id: 'reranker',
        kind: 'reranker',
        required: false,
        ...reranker,
      },
    ],
  };
}

export function downloadLocalModel(id: LocalModelId): { ok: boolean; message?: string } {
  if (id === 'embedding') return startEmbeddingDownload();
  if (id === 'reranker') return startRerankerDownload();
  return { ok: false, message: `unknown model: ${id}` };
}

export async function updateLocalModel(
  id: LocalModelId,
  patch: { enabled?: boolean },
): Promise<{ hfEndpoint: string | null; models: LocalModelStatus[] }> {
  if (id === 'reranker' && typeof patch.enabled === 'boolean') {
    await setRerankerEnabled(patch.enabled);
    return getLocalModelsStatus();
  }
  throw new Error(`unsupported update for model: ${id}`);
}

export async function removeLocalModel(id: LocalModelId) {
  if (id === 'embedding') return removeEmbeddingModel();
  if (id === 'reranker') return removeRerankerModel();
  throw new Error(`unknown model: ${id}`);
}
