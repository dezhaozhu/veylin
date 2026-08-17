/**
 * **没挂数据源的项目,不能读到任何场景的数据。**
 *
 * 实测踩到的真事:项目「111」的数据源那一栏明明白白写着"这个项目只用你自己的
 * 文件",而 agent 在里面回答了一整页 shangzhong 的排产数据。
 *
 * 机制:空 sources 仍然拿到了 compass 连接,发出的场景头是空串;而场景绑定那一侧,
 * **非 account 的旧式 token 会忽略场景头**,落回它自己烘焙的租户。两边各自"没错",
 * 合起来就是越过项目边界读到了另一个厂的数据 —— 而且界面上看起来完全正常。
 *
 * 修的姿态:空 sources ⇒ **只留发现类工具**(list_my_scenes)。全砍掉的话,
 * "我有哪些数据源可以挂"这条路也断了,新项目就没法上手了。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { restrictSourcelessToolset, SCENE_FREE_TOOLS } from './compass-sourceless.js';

const toolset = {
  list_my_scenes: { execute: async () => ({}) },
  get_cockpit: { execute: async () => ({}) },
  get_health: { execute: async () => ({}) },
  get_schedule_rows: { execute: async () => ({}) },
};

describe('空数据源的项目', () => {
  it('**读数据的工具一个都不留**', () => {
    const out = restrictSourcelessToolset(toolset, []);
    assert.ok(!('get_cockpit' in out), 'get_cockpit 还在 —— 它能读到场景数据');
    assert.ok(!('get_health' in out));
    assert.ok(!('get_schedule_rows' in out));
  });

  it('**发现类留着** —— 不然"我有哪些数据源可以挂"这条路也断了', () => {
    const out = restrictSourcelessToolset(toolset, []);
    assert.ok('list_my_scenes' in out);
    assert.deepEqual(Object.keys(out), [...SCENE_FREE_TOOLS]);
  });

  it('挂了数据源的项目一个不动 —— 这条修的是空 sources,不是给所有项目加闸', () => {
    const out = restrictSourcelessToolset(toolset, ['shangzhong']);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(toolset).sort());
  });

  it('空 toolset 不炸', () => {
    assert.deepEqual(restrictSourcelessToolset({}, []), {});
  });
});
