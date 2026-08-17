/**
 * 见 sheet-payload-guard.ts:迟到的响应盖住当前表 = 用户看到的"点不动"。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldApplyPayload } from './sheet-payload-guard';

describe('shouldApplyPayload', () => {
  it('是当前这张表 → 收', () => {
    assert.equal(shouldApplyPayload('a', 'a'), true);
  });

  it('**是别的表 → 丢掉**,这正是迟到响应盖屏的那一刀', () => {
    assert.equal(shouldApplyPayload('sheet_1', '开发组件'), false);
  });

  it('响应没说自己是哪张表 → 照收(老响应/构造的空载荷不能被误伤)', () => {
    assert.equal(shouldApplyPayload(undefined, 'a'), true);
  });

  it('还没有当前表 → 照收(首屏就是靠它把表定下来的)', () => {
    assert.equal(shouldApplyPayload('a', undefined), true);
  });
});
