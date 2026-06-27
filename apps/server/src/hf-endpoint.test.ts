import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildHfResolveUrl, __test__ } from './hf-endpoint.js';

describe('hf endpoint', () => {
  it('builds resolve URLs for model files', () => {
    const url = buildHfResolveUrl('https://hf-mirror.com', 'BAAI/bge-small-en-v1.5', 'onnx/model.onnx');
    assert.equal(url, 'https://hf-mirror.com/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx');
  });

  it('encodes model path segments', () => {
    const url = buildHfResolveUrl('https://huggingface.co', 'Xenova/ms-marco-MiniLM-L-6-v2', 'tokenizer.json');
    assert.ok(url.includes('Xenova/ms-marco-MiniLM-L-6-v2'));
  });

  it('exposes official host candidates', () => {
    assert.deepEqual(__test__.HF_HOSTS, ['https://huggingface.co', 'https://hf-mirror.com']);
  });
});
