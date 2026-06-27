export { connectDb, getDb, closeDb, type Database } from './client';
export { resolveDataDir, ensureDataDir, surrealKvUrl, mastraLibsqlUrl } from './paths';
export {
  LOCAL_EMBEDDING_HF_MODEL_ID,
  LOCAL_EMBEDDING_FASTEMBED_KEY,
  LOCAL_RERANKER_HF_MODEL_ID,
  HF_EMBEDDING_CACHE_DIR,
  HF_RERANKER_CACHE_DIR,
  LOCAL_EMBEDDING_ONNX_FILE,
  EMBEDDING_REQUIRED_FILES,
  embeddingCacheDir,
  embeddingModelDir,
  embeddingOnnxPath,
  isEmbeddingModelReady,
  isEmbeddingModelOnDisk,
  rerankerCacheDir,
  rerankerOnnxPaths,
  isRerankerModelOnDisk,
} from './local-model-paths';
export { queryRows, newId, rid, normalizeId } from './query';
export * from './types';
export * from './repos';
export * from './table-repos';
export * from './rag-repos';
export * from './vector-index';
export * from './workflow-repos';
