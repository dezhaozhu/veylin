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

  it('**首屏那个未解析的 main 要照收** —— 否则面板永远停在"加载中"', () => {
    // 面板的初值是字面量 'main',而服务端回的是解析后的 `me~main` / `p_x~main`。
    // 按"不相等就丢"处理的话,首屏这份**正确的**数据会被当成迟到响应丢掉,
    // loading 永远清不掉(实测:首页打开表格面板一直转圈)。
    assert.equal(shouldApplyPayload('me~main', 'main'), true);
    assert.equal(shouldApplyPayload('p_abc~sheet_1', 'main'), true);
  });

  it('已经落到具体某张表之后,还是要挡住别的表', () => {
    assert.equal(shouldApplyPayload('me~main', 'me~组件'), false);
  });
});
