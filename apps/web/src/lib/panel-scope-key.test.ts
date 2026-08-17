import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { panelScopeKey } from './panel-scope-key';

describe('panelScopeKey', () => {
  it('**同一条对话改钉到别的项目 → 身份变了**,面板必须跟着重取', () => {
    assert.notEqual(panelScopeKey('t1', 'A'), panelScopeKey('t1', 'B'));
  });

  it('**取消归属(回到个人区)也算变**', () => {
    assert.notEqual(panelScopeKey('t1', 'A'), panelScopeKey('t1', null));
  });

  it('换对话当然算变', () => {
    assert.notEqual(panelScopeKey('t1', 'A'), panelScopeKey('t2', 'A'));
  });

  it('什么都没变就不算变 —— 否则每次渲染都白重取一次', () => {
    assert.equal(panelScopeKey('t1', 'A'), panelScopeKey('t1', 'A'));
    assert.equal(panelScopeKey(undefined, null), panelScopeKey(undefined, undefined));
  });
});
