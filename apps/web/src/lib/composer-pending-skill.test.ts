import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commitPendingSkillAtEnd,
  commitPendingSkillSelection,
} from './composer-pending-skill';

describe('commitPendingSkillSelection', () => {
  it('removes slash query and records insert position without inline token', () => {
    let text = '';
    let skill: string | null = null;
    let insertAt = 0;

    const result = commitPendingSkillSelection(
      (next) => {
        text = next;
      },
      (name, at) => {
        skill = name;
        insertAt = at;
      },
      'hello /ski',
      'skill-creator',
      6,
      10,
    );

    assert.equal(result.text, 'hello ');
    assert.equal(text, 'hello ');
    assert.equal(skill, 'skill-creator');
    assert.equal(insertAt, 6);
    assert.equal(result.cursor, 6);
  });
});

describe('commitPendingSkillAtEnd', () => {
  it('attaches skill at end with spacing', () => {
    let insertAt = -1;
    commitPendingSkillAtEnd(
      () => {},
      (_name, at) => {
        insertAt = at;
      },
      'hello',
      'skill-creator',
    );
    assert.equal(insertAt, 6);
  });
});
