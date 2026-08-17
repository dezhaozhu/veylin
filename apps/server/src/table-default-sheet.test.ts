/**
 * **一个项目里没有「主表」,不该等于这个项目的表打不开。**
 *
 * 不带 sheet 参数取数时,服务端退回作用域的默认表 `<scope>~main`。可项目里的表
 * 完全可以没有那一张 —— agent 建的叫「组件」,导入的叫「开发组件」,谁都没叫
 * main。于是整个项目的表在面板里 404:
 *
 *   [SCOPEDBG] both failed: sheet not found
 *
 * 实测是这么撞上的:把一条对话改钉到另一个项目,面板去重取新作用域 → 404 →
 * 屏幕上继续摆着**上一个项目的表**。而这条错误从前被一句空 catch 吞掉,
 * 表现成"面板没跟过来",根因查不出来。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTableSheet, tryResolveTableSheetId } from './table-store.js';
import { projectScope } from './table-scope.js';

describe('默认表的退路', () => {
  it('**没有 main 时退到这个作用域里已有的第一张**,而不是 404', () => {
    const scope = projectScope(`p-${Date.now()}`);
    const sheet = createTableSheet('组件', scope)!;
    assert.equal(tryResolveTableSheetId(undefined, scope), sheet.id);
  });

  it('有 main 就还是用 main —— 老行为不变', () => {
    const scope = projectScope(`p2-${Date.now()}`);
    createTableSheet('组件', scope);
    const main = createTableSheet('main', scope)!;
    assert.equal(tryResolveTableSheetId(undefined, scope), main.id);
  });

  it('作用域里一张表都没有,才是真的没有', () => {
    assert.equal(tryResolveTableSheetId(undefined, projectScope(`empty-${Date.now()}`)), null);
  });

  it('**退路不许跨作用域** —— 别的项目有表不代表这个项目有', () => {
    const mine = projectScope(`mine-${Date.now()}`);
    createTableSheet('别人的表', projectScope(`other-${Date.now()}`));
    assert.equal(tryResolveTableSheetId(undefined, mine), null);
  });
});
