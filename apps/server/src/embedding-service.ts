import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { embedMany } from 'ai';
import { fastembed } from '@mastra/fastembed';
import { buildHfResolveUrl, resolveHuggingfaceEndpoint } from './hf-endpoint';
import { downloadFile } from './hf-download';

/** Official Hugging Face model repo. */
export const EMBEDDING_HF_MODEL_ID = 'BAAI/bge-small-en-v1.5';
export const EMBEDDING_CACHE_KEY = 'fast-bge-small-en-v1.5';

const EMBEDDING_FILES: Array<{ remote: string; local: string }> = [
  { remote: 'onnx/model.onnx', local: 'model_optimized.onnx' },
  { remote: 'config.json', local: 'config.json' },
  { remote: 'tokenizer.json', local: 'tokenizer.json' },
  { remote: 'tokenizer_config.json', local: 'tokenizer_config.json' },
  { remote: 'special_tokens_map.json', local: 'special_tokens_map.json' },
  { remote: 'vocab.txt', local: 'vocab.txt' },
];

export type EmbeddingDownloadPhase = 'idle' | 'downloading' | 'ready' | 'error';

export type EmbeddingDownloadState = {
  phase: EmbeddingDownloadPhase;
  progress: number;
  message: string;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type EmbeddingStatus = {
  id: 'embedding';
  kind: 'embedding';
  required: true;
  modelId: string;
  installed: boolean;
  download: EmbeddingDownloadState;
  installedAt: string | null;
  lastError: string | null;
  hfEndpoint: string | null;
};

let downloadState: EmbeddingDownloadState = {
  phase: 'idle',
  progress: 0,
  message: '',
  error: null,
};
let downloadPromise: Promise<void> | null = null;
let lastHfEndpoint: string | null = null;

export function embeddingCacheDir(): string {
  return join(homedir(), '.cache', 'mastra', 'fastembed-models');
}

export function embeddingModelDir(): string {
  return join(embeddingCacheDir(), EMBEDDING_CACHE_KEY);
}

export function isEmbeddingModelInstalled(): boolean {
  return existsSync(join(embeddingModelDir(), 'model_optimized.onnx'));
}

function updateDownloadState(patch: Partial<EmbeddingDownloadState>): void {
  downloadState = { ...downloadState, ...patch };
}

export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const installed = downloadState.phase === 'downloading' ? false : isEmbeddingModelInstalled();
  const phase =
    downloadState.phase === 'downloading'
      ? 'downloading'
      : downloadState.phase === 'error'
        ? 'error'
        : installed
          ? 'ready'
          : 'idle';

  return {
    id: 'embedding',
    kind: 'embedding',
    required: true,
    modelId: EMBEDDING_HF_MODEL_ID,
    installed,
    download: {
      ...downloadState,
      phase,
      progress: phase === 'ready' ? 100 : downloadState.progress,
    },
    installedAt: null,
    lastError: downloadState.error ?? null,
    hfEndpoint: lastHfEndpoint,
  };
}

export function startEmbeddingDownload(): { ok: boolean; message?: string } {
  if (downloadPromise) {
    return { ok: true, message: 'already downloading' };
  }
  if (isEmbeddingModelInstalled()) {
    updateDownloadState({ phase: 'ready', progress: 100, message: 'ready', error: null });
    return { ok: true, message: 'already installed' };
  }

  downloadPromise = (async () => {
    updateDownloadState({
      phase: 'downloading',
      progress: 0,
      message: 'resolve-endpoint',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const modelDir = embeddingModelDir();
    mkdirSync(modelDir, { recursive: true });

    try {
      const endpoint = await resolveHuggingfaceEndpoint();
      lastHfEndpoint = endpoint;
      const totalFiles = EMBEDDING_FILES.length;

      for (let index = 0; index < EMBEDDING_FILES.length; index++) {
        const entry = EMBEDDING_FILES[index]!;
        const dest = join(modelDir, entry.local);
        const url = buildHfResolveUrl(endpoint, EMBEDDING_HF_MODEL_ID, entry.remote);
        const baseProgress = Math.round((index / totalFiles) * 100);

        updateDownloadState({ message: entry.remote, progress: baseProgress });
        await downloadFile(url, dest, (loaded, total) => {
          const slice = total > 0 ? (loaded / total) * (100 / totalFiles) : 0;
          updateDownloadState({
            progress: Math.min(99, Math.round(baseProgress + slice)),
            message: entry.remote,
          });
        });
      }

      if (!isEmbeddingModelInstalled()) {
        throw new Error('Embedding model files missing after download');
      }

      writeFileSync(
        join(modelDir, '.hf-source.json'),
        `${JSON.stringify({ modelId: EMBEDDING_HF_MODEL_ID, endpoint }, null, 2)}\n`,
        'utf8',
      );

      updateDownloadState({
        phase: 'ready',
        progress: 100,
        message: 'ready',
        error: null,
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateDownloadState({
        phase: 'error',
        progress: 0,
        message,
        error: message,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      downloadPromise = null;
    }
  })();

  return { ok: true };
}

export async function removeEmbeddingModel(): Promise<EmbeddingStatus> {
  if (downloadPromise) {
    throw new Error('Cannot remove embedding model while downloading');
  }
  const modelDir = embeddingModelDir();
  if (existsSync(modelDir)) rmSync(modelDir, { recursive: true, force: true });
  updateDownloadState({
    phase: 'idle',
    progress: 0,
    message: '',
    error: null,
    startedAt: null,
    finishedAt: null,
  });
  return getEmbeddingStatus();
}

export async function embedTextsIfInstalled(values: string[]): Promise<number[][] | null> {
  if (!isEmbeddingModelInstalled()) return null;
  try {
    const { embeddings } = await embedMany({ model: fastembed, values });
    return embeddings;
  } catch (err) {
    console.warn('[rag] embedding unavailable:', err);
    return null;
  }
}

export const __test__ = {
  EMBEDDING_FILES,
  resetForTest: () => {
    downloadState = { phase: 'idle', progress: 0, message: '', error: null };
    downloadPromise = null;
    lastHfEndpoint = null;
  },
};
