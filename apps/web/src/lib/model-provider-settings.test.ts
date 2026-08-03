import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelProviderSettings } from './model-provider-settings.ts';

describe('normalizeModelProviderSettings', () => {
  it('passes through the current API shape', () => {
    assert.deepEqual(
      normalizeModelProviderSettings({
        modelName: 'gpt-4o-mini',
        requestUrl: 'https://api.example.com/v1',
        hasApiKey: true,
        configured: true,
      }),
      {
        modelName: 'gpt-4o-mini',
        requestUrl: 'https://api.example.com/v1',
        hasApiKey: true,
        configured: true,
      },
    );
  });

  it('derives configured from api key + endpoint metadata', () => {
    assert.deepEqual(
      normalizeModelProviderSettings({
        modelName: 'gpt-4o',
        requestUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
      }),
      {
        modelName: 'gpt-4o',
        requestUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
        configured: true,
      },
    );
  });

  it('is not configured without complete provider metadata', () => {
    assert.deepEqual(
      normalizeModelProviderSettings({
        modelName: 'gpt-4o',
        hasApiKey: true,
      }),
      {
        modelName: 'gpt-4o',
        requestUrl: '',
        hasApiKey: true,
        configured: false,
      },
    );
  });
});
