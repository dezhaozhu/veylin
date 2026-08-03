import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  composerHasSendableDraft,
  isImeComposing,
} from './composer-submit-keys';

describe('composer integration keys', () => {
  it('isImeComposing blocks Enter submit during composition', () => {
    assert.equal(
      isImeComposing({ key: 'Enter', isComposing: true }),
      true,
    );
    assert.equal(
      isImeComposing({ key: 'Enter', keyCode: 229 }),
      true,
    );
    assert.equal(
      isImeComposing({ key: 'Enter', isComposing: false }),
      false,
    );
  });

  it('pending skill alone is sendable draft', () => {
    assert.equal(
      composerHasSendableDraft({ composerEmpty: true, hasPendingSkill: true }),
      true,
    );
  });
});
