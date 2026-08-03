import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listConfiguredModels } from './model-availability.ts';

describe('model availability', () => {
  it('derives a catalog entry from saved provider settings when local catalog is empty', () => {
    const models = listConfiguredModels({
      configured: true,
      modelName: 'gpt-4o-mini',
    });
    assert.equal(models.length, 1);
    assert.equal(models[0]?.id, 'gpt-4o-mini');
    assert.equal(models[0]?.label, 'gpt-4o-mini');
  });

  it('returns nothing when provider is not configured', () => {
    assert.deepEqual(listConfiguredModels({ configured: false, modelName: '' }), []);
  });
});
