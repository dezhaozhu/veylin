import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSkillsCatalogBlock, type SkillListItem } from './skills.js';

function skill(partial: Partial<SkillListItem> & Pick<SkillListItem, 'name'>): SkillListItem {
  return {
    description: partial.description ?? '',
    source: partial.source ?? 'bundled',
    type: 'knowledge',
    triggers: [],
    enabled: partial.enabled ?? true,
    disableModelInvocation: partial.disableModelInvocation ?? false,
    userInvocable: partial.userInvocable ?? true,
    ...partial,
  };
}

describe('buildSkillsCatalogBlock', () => {
  it('lists auto-invocable skills separately from manual-only', () => {
    const block = buildSkillsCatalogBlock([
      skill({ name: 'research', description: 'Find docs' }),
      skill({
        name: 'deploy',
        description: 'Ship to prod',
        disableModelInvocation: true,
      }),
    ]);
    assert.match(block, /## Available Skills/);
    assert.match(block, /research/);
    assert.match(block, /## Manual-only Skills/);
    assert.match(block, /deploy/);
    assert.match(block, /Do not load these with the `skill` tool/);
  });

  it('returns empty when no enabled skills', () => {
    assert.equal(
      buildSkillsCatalogBlock([skill({ name: 'x', enabled: false })]),
      '',
    );
  });
});
