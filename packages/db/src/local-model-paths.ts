import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from './paths';

/** Hugging Face repo id for the local embedding model. */
export const LOCAL_EMBEDDING_HF_MODEL_ID = 'BAAI/bge-small-en-v1.5';

/** Directory name under the embedding cache (fastembed / FlagEmbedding layout). */
export const LOCAL_EMBEDDING_FASTEMBED_KEY = 'fast-bge-small-en-v1.5';

/** Hugging Face repo id for the local reranker model. */
export const LOCAL_RERANKER_HF_MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2';

export const HF_EMBEDDING_CACHE_DIR = 'hf-embedding-cache';
export const HF_RERANKER_CACHE_DIR = 'hf-reranker-cache';
export const LOCAL_EMBEDDING_ONNX_FILE = 'model_optimized.onnx';

/** Files required before fastembed / RAG vector paths are safe to use. */
export const EMBEDDING_REQUIRED_FILES = [
  LOCAL_EMBEDDING_ONNX_FILE,
  'tokenizer.json',
  'config.json',
] as const;

export function embeddingCacheDir(dataDir?: string): string {
  return join(dataDir ?? resolveDataDir(), HF_EMBEDDING_CACHE_DIR);
}

export function embeddingModelDir(dataDir?: string): string {
  return join(embeddingCacheDir(dataDir), LOCAL_EMBEDDING_FASTEMBED_KEY);
}

export function embeddingOnnxPath(dataDir?: string): string {
  return join(embeddingModelDir(dataDir), LOCAL_EMBEDDING_ONNX_FILE);
}

export function isEmbeddingModelReady(dataDir?: string): boolean {
  const dir = embeddingModelDir(dataDir);
  return EMBEDDING_REQUIRED_FILES.every((file) => existsSync(join(dir, file)));
}

/** @deprecated Prefer {@link isEmbeddingModelReady} — name kept for callers. */
export function isEmbeddingModelOnDisk(dataDir?: string): boolean {
  return isEmbeddingModelReady(dataDir);
}

export function rerankerCacheDir(dataDir?: string): string {
  return join(dataDir ?? resolveDataDir(), HF_RERANKER_CACHE_DIR);
}

/** @huggingface/transformers cache layout: {cacheDir}/{modelId}/onnx/model.onnx */
export function rerankerOnnxPaths(modelId: string, dataDir?: string): string[] {
  const cache = rerankerCacheDir(dataDir);
  return [join(cache, modelId, 'onnx', 'model.onnx'), join(cache, modelId, 'model.onnx')];
}

export function isRerankerModelOnDisk(modelId: string, dataDir?: string): boolean {
  return rerankerOnnxPaths(modelId, dataDir).some((path) => existsSync(path));
}
