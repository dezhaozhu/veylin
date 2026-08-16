/**
 * Compass 那一行在各种状态下说什么。
 *
 * 单独测措辞,是因为这类文案最容易在改动中退化成"连接失败"这种什么也没说的话,
 * 而它恰恰是新用户唯一能看到的解释。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compassActionLabel, describeCompassRow } from './compass-connection.js';

describe('没连接', () => {
  it('说清楚连上之后会得到什么 —— 而不是只说"未连接"', () => {
    const s = describeCompassRow(null);
    assert.equal(s.action, 'connect');
    assert.match(s.subtitle, /数据源/);
  });

  it('configured=false 同理', () => {
    assert.equal(describeCompassRow({ configured: false }).action, 'connect');
  });
});

describe('连上了', () => {
  it('说出以谁的身份 —— 这是别处看不到的那个事实', () => {
    const s = describeCompassRow({ configured: true, username: '张三', sources: ['guolu'] });
    assert.match(s.subtitle, /张三/);
    assert.equal(s.action, 'manage');
  });

  it('**连上了但一个数据源都没有,必须说出来** —— 否则人会以为是产品坏了', () => {
    const s = describeCompassRow({ configured: true, username: '张三', sources: [] });
    assert.match(s.subtitle, /空白|没有/);
  });

  it('数据源用显示名,不把带指纹的租户 id 摆出来', () => {
    const s = describeCompassRow({ configured: true, username: 'a', sources: ['me:a-1234abcd'] });
    assert.ok(!s.subtitle.includes('1234abcd'), `不该露出内部 id: ${s.subtitle}`);
    assert.match(s.subtitle, /我的工作区/);
  });

  it('拿不到用户名就标成未知,不猜也不留空', () => {
    assert.match(describeCompassRow({ configured: true, sources: ['a'] }).subtitle, /未知身份/);
  });
});

describe('连不上', () => {
  it('是**状态**不是"没配置" —— 给的动作是重连,不是从头再连一遍', () => {
    const s = describeCompassRow({ configured: true, error: 'token 已过期' });
    assert.equal(s.action, 'reconnect');
    assert.match(s.subtitle, /过期/);
  });
});

describe('按钮文字', () => {
  it('三种状态三种说法', () => {
    assert.equal(compassActionLabel('connect'), '连接');
    assert.equal(compassActionLabel('reconnect'), '重新连接');
    assert.equal(compassActionLabel('manage'), '管理');
  });
});
