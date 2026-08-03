import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { __test__ } from './reranker-service.js';

describe('reranker service', () => {
  it('maps tokenizer step progress into 0-50 range', () => {
    const updates: Array<{ progress: number; message: string }> = [];
    const cb = __test__.createStepProgressCallback('tokenizer', (progress, message) => {
      updates.push({ progress, message });
    });
    cb({ status: 'progress', file: 'tokenizer.json', progress: 50 });
    assert.equal(updates.at(-1)?.progress, 25);
    cb({ status: 'done', file: 'tokenizer.json' });
    assert.equal(updates.at(-1)?.progress, 50);
  });

  it('maps model step progress into 50-100 range', () => {
    const updates: number[] = [];
    const cb = __test__.createStepProgressCallback('model', (progress) => {
      updates.push(progress);
    });
    cb({ status: 'progress', file: 'model.onnx', progress: 100 });
    assert.equal(updates.at(-1), 100);
  });
});
