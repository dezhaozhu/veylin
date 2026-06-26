import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelProviderSettings } from './model-provider-settings.ts';

describe('normalizeModelProviderSettings', () => {
  it('passes through the current API shape', () => {
    assert.deepEqual(
      normalizeModelProviderSettings({
        modelName: 'deepseek-v4-flash',
        requestUrl: 'https://api.deepseek.com/v1',
        hasApiKey: true,
        configured: true,
      }),
      {
        modelName: 'deepseek-v4-flash',
        requestUrl: 'https://api.deepseek.com/v1',
        hasApiKey: true,
        configured: true,
      },
    );
  });

  it('maps legacy modelAvailability flags to configured', () => {
    assert.deepEqual(
      normalizeModelProviderSettings({
        modelName: 'gpt-4o',
        requestUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
        modelAvailability: { deepseek: true, zenmux: false },
      } as never),
      {
        modelName: 'gpt-4o',
        requestUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
        configured: true,
      },
    );
  });

  it('does not treat legacy flags as configured without api key metadata', () => {
    assert.deepEqual(
      normalizeModelProviderSettings({
        openaiApiKeyEnabled: true,
        hasOpenaiApiKey: true,
        overrideOpenAIBaseUrl: true,
        openaiBaseUrl: 'https://api.deepseek.com/v1',
      } as never),
      {
        modelName: '',
        requestUrl: '',
        hasApiKey: false,
        configured: false,
      },
    );
  });
});
