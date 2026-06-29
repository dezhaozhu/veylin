import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatSkillCatalogDescription,
  parseSkillFrontmatter,
  skillActivationBody,
  SKILL_CATALOG_DESCRIPTION_MAX,
  stripSkillFrontmatter,
} from './skill-frontmatter.js';

describe('parseSkillFrontmatter', () => {
  it('reads Claude Code frontmatter fields', () => {
    const fm = parseSkillFrontmatter(`---
name: deploy
description: Deploy to production
when_to_use: User asks to ship or release
disable-model-invocation: true
user-invocable: true
---

# Deploy
`);
    assert.equal(fm.name, 'deploy');
    assert.equal(fm.description, 'Deploy to production');
    assert.equal(fm.whenToUse, 'User asks to ship or release');
    assert.equal(fm.disableModelInvocation, true);
    assert.equal(fm.userInvocable, true);
  });
});

describe('formatSkillCatalogDescription', () => {
  it('merges description and when_to_use', () => {
    const text = formatSkillCatalogDescription({
      description: 'Does X.',
      whenToUse: 'When user mentions X.',
    });
    assert.equal(text, 'Does X. When user mentions X.');
  });

  it('truncates long catalog text', () => {
    const long = 'a'.repeat(SKILL_CATALOG_DESCRIPTION_MAX + 50);
    const text = formatSkillCatalogDescription({ description: long });
    assert.ok(text.length <= SKILL_CATALOG_DESCRIPTION_MAX);
    assert.ok(text.endsWith('…'));
  });
});

describe('skillActivationBody', () => {
  it('strips frontmatter and adds base directory', () => {
    const body = skillActivationBody(
      `---
name: x
description: y
---
# Instructions
Do the thing.`,
      '/skills/x',
    );
    assert.ok(!body.includes('---'));
    assert.ok(body.startsWith('Base directory for this skill: /skills/x'));
    assert.ok(body.includes('# Instructions'));
  });
});

describe('stripSkillFrontmatter', () => {
  it('returns content unchanged when no frontmatter', () => {
    assert.equal(stripSkillFrontmatter('# Hi'), '# Hi');
  });
});
