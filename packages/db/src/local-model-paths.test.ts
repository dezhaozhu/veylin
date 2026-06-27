import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  HF_EMBEDDING_CACHE_DIR,
  HF_RERANKER_CACHE_DIR,
  LOCAL_EMBEDDING_FASTEMBED_KEY,
  LOCAL_EMBEDDING_ONNX_FILE,
  LOCAL_RERANKER_HF_MODEL_ID,
  isEmbeddingModelOnDisk,
  isRerankerModelOnDisk,
} from './local-model-paths.js';

describe('local model paths', () => {
  it('detects embedding only when all required files exist', () => {
    const prev = process.env.VEYLIN_DATA_DIR;
    const root = mkdtempSync(join(tmpdir(), 'veylin-embedding-test-'));
    process.env.VEYLIN_DATA_DIR = root;
    try {
      const modelDir = join(root, HF_EMBEDDING_CACHE_DIR, LOCAL_EMBEDDING_FASTEMBED_KEY);
      mkdirSync(modelDir, { recursive: true });
      writeFileSync(join(modelDir, LOCAL_EMBEDDING_ONNX_FILE), 'fake');
      assert.equal(isEmbeddingModelOnDisk(), false);
      writeFileSync(join(modelDir, 'tokenizer.json'), '{}');
      writeFileSync(join(modelDir, 'config.json'), '{}');
      assert.equal(isEmbeddingModelOnDisk(), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      if (prev === undefined) delete process.env.VEYLIN_DATA_DIR;
      else process.env.VEYLIN_DATA_DIR = prev;
    }
  });

  it('detects reranker onnx under VEYLIN_DATA_DIR', () => {
    const prev = process.env.VEYLIN_DATA_DIR;
    const root = mkdtempSync(join(tmpdir(), 'veylin-reranker-test-'));
    process.env.VEYLIN_DATA_DIR = root;
    try {
      const onnxPath = join(
        root,
        HF_RERANKER_CACHE_DIR,
        LOCAL_RERANKER_HF_MODEL_ID,
        'onnx',
        'model.onnx',
      );
      mkdirSync(join(onnxPath, '..'), { recursive: true });
      writeFileSync(onnxPath, 'fake');
      assert.equal(isRerankerModelOnDisk(LOCAL_RERANKER_HF_MODEL_ID), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      if (prev === undefined) delete process.env.VEYLIN_DATA_DIR;
      else process.env.VEYLIN_DATA_DIR = prev;
    }
  });
});
