import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getModelConfig,
  getRuntimeModelOverrides,
  isModelProviderConfigured,
  setRuntimeModelOverrides,
} from './model-resolve.js';

describe('model-resolve', () => {
  it('isModelProviderConfigured requires all fields', () => {
    assert.equal(
      isModelProviderConfigured({ modelName: 'm', requestUrl: 'https://x/v1', apiKey: 'k' }),
      true,
    );
    assert.equal(
      isModelProviderConfigured({ modelName: 'm', requestUrl: '', apiKey: 'k' }),
      false,
    );
  });

  it('getModelConfig applies runtime overrides to env fallback', () => {
    const prev = getRuntimeModelOverrides();
    setRuntimeModelOverrides({
      modelName: 'deepseek-v4',
      requestUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
    const cfg = getModelConfig('__test_non_catalog_model__');
    assert.equal(cfg.modelId, 'deepseek-v4');
    assert.equal(cfg.url, 'https://api.example.com/v1');
    assert.equal(cfg.apiKey, 'sk-test');
    setRuntimeModelOverrides(prev);
  });
});
