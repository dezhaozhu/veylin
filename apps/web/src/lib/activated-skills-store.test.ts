import assert from 'node:assert/strict';
import test from 'node:test';
import { skillChipDisplayName } from './activated-skills-store';

test('skillChipDisplayName uses segment after last colon', () => {
  assert.equal(
    skillChipDisplayName('scheduling-optimizer:scheduling-orchestrator'),
    'scheduling-orchestrator',
  );
  assert.equal(skillChipDisplayName('plain-skill'), 'plain-skill');
  assert.equal(skillChipDisplayName('a:b:c'), 'c');
});
