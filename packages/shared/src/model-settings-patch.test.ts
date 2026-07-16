import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeModelProviderSettings,
  modelProviderSettingsPatchSchema,
  modelProviderSettingsSchema,
} from './model.js';

describe('modelProviderSettingsPatchSchema', () => {
  it('does not invent empty requestUrl/apiKey for a modelName-only patch', () => {
    const parsed = modelProviderSettingsPatchSchema.parse({ modelName: 'MiniMax' });
    assert.deepEqual(parsed, { modelName: 'MiniMax' });
    assert.equal('requestUrl' in parsed, false);
    assert.equal('apiKey' in parsed, false);
  });
});

describe('mergeModelProviderSettings', () => {
  it('keeps existing requestUrl and apiKey when only modelName changes', () => {
    const existing = modelProviderSettingsSchema.parse({
      modelName: 'compass-v1',
      requestUrl: 'https://example.com/v1',
      apiKey: 'sk-keep',
    });
    const next = mergeModelProviderSettings(existing, { modelName: 'MiniMax' });
    assert.equal(next.modelName, 'MiniMax');
    assert.equal(next.requestUrl, 'https://example.com/v1');
    assert.equal(next.apiKey, 'sk-keep');
  });

  it('keeps existing apiKey when patch omits or blanks it', () => {
    const existing = modelProviderSettingsSchema.parse({
      modelName: 'MiniMax',
      requestUrl: 'https://example.com/v1',
      apiKey: 'sk-keep',
    });
    assert.equal(mergeModelProviderSettings(existing, {}).apiKey, 'sk-keep');
    assert.equal(mergeModelProviderSettings(existing, { apiKey: '' }).apiKey, 'sk-keep');
    assert.equal(mergeModelProviderSettings(existing, { apiKey: '  ' }).apiKey, 'sk-keep');
  });
});
