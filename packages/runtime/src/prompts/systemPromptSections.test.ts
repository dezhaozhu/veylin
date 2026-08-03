import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  clearSystemPromptSections,
  resolveSystemPromptSections,
  systemPromptSection,
  uncachedSystemPromptSection,
} from './systemPromptSections.js';

describe('systemPromptSections', () => {
  beforeEach(() => {
    clearSystemPromptSections();
  });

  it('caches stable sections across resolves', async () => {
    let runs = 0;
    const section = systemPromptSection('test_cached', () => {
      runs += 1;
      return `value-${runs}`;
    });

    const first = await resolveSystemPromptSections([section]);
    const second = await resolveSystemPromptSections([section]);

    assert.deepEqual(first, ['value-1']);
    assert.deepEqual(second, ['value-1']);
    assert.equal(runs, 1);
  });

  it('recomputes uncached sections every turn', async () => {
    let runs = 0;
    const section = uncachedSystemPromptSection('test_dynamic', () => {
      runs += 1;
      return `value-${runs}`;
    });

    const first = await resolveSystemPromptSections([section]);
    const second = await resolveSystemPromptSections([section]);

    assert.deepEqual(first, ['value-1']);
    assert.deepEqual(second, ['value-2']);
  });

  it('clearSystemPromptSections drops cached values', async () => {
    let runs = 0;
    const section = systemPromptSection('test_reset', () => {
      runs += 1;
      return `value-${runs}`;
    });

    await resolveSystemPromptSections([section]);
    clearSystemPromptSections();
    const again = await resolveSystemPromptSections([section]);

    assert.deepEqual(again, ['value-2']);
  });
});
