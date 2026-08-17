import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { projectSourceLabel } from './project.js';

describe('个人工作区的显示名', () => {
  it('不把带指纹的租户 id 摆给用户看', () => {
    assert.equal(projectSourceLabel('me:alice-a1185b28'), '我的工作区');
  });

  it('工厂场景照旧', () => {
    assert.equal(projectSourceLabel('guolu'), '锅炉厂');
  });

  it('不认识的原样显示 —— 不猜', () => {
    assert.equal(projectSourceLabel('newfactory'), 'newfactory');
  });
});
