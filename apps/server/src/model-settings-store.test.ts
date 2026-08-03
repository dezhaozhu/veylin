import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isModelProviderConfigured } from '@veylin/runtime';

describe('model-settings-store view logic', () => {
  it('configured when modelName, requestUrl, and apiKey are set', () => {
    assert.equal(
      isModelProviderConfigured({
        modelName: 'deepseek-v4-flash',
        requestUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-secret',
      }),
      true,
    );
  });

  it('not configured when modelName is empty', () => {
    assert.equal(
      isModelProviderConfigured({
        modelName: '',
        requestUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-secret',
      }),
      false,
    );
  });
});
