/**
 * 表的归属(spec: docs/specs/2026-08-13-table-scope-context.md §1、§3)。
 *
 * 一条规则:**你在哪个作用域,就看到那个作用域的 context**。
 * 这个文件只钉 id 与作用域的换算 —— 纯函数,不碰 store。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONAL_SCOPE,
  projectScope,
  threadScope,
  scopeKey,
  sameScope,
  sheetIdFor,
  shortNameOf,
  scopeOfSheetId,
} from './table-scope.js';

describe('作用域的 key', () => {
  it('三种作用域各有稳定的短前缀', () => {
    assert.equal(scopeKey(PERSONAL_SCOPE), 'me');
    assert.equal(scopeKey(projectScope('proj-guolu')), 'p_proj-guolu');
    assert.equal(scopeKey(threadScope('t-42')), 't_t-42');
  });

  it('id 里不安全的字符被换掉 —— 前缀要能安全地进 URL 和记录 id', () => {
    assert.equal(scopeKey(projectScope('a/b:c d')), 'p_a-b-c-d');
  });

  it('同一个作用域算出同一个 key(迁移要幂等)', () => {
    assert.equal(scopeKey(projectScope('p1')), scopeKey(projectScope('p1')));
    assert.ok(sameScope(projectScope('p1'), projectScope('p1')));
    assert.ok(!sameScope(projectScope('p1'), projectScope('p2')));
    assert.ok(!sameScope(PERSONAL_SCOPE, threadScope('me')), '个人区 ≠ 名叫 me 的对话');
  });
});

describe('内部 id ↔ 短名', () => {
  it('内部 id = 作用域前缀 ~ 短名', () => {
    assert.equal(sheetIdFor(projectScope('guolu'), 'schedule'), 'p_guolu~schedule');
    assert.equal(sheetIdFor(PERSONAL_SCOPE, 'main'), 'me~main');
  });

  it('分隔符不用冒号 —— SurrealDB 的记录 id 就是 table:id,撞上会出鬼', () => {
    assert.ok(!sheetIdFor(projectScope('guolu'), 'schedule').includes(':'));
  });

  it('短名取得回来', () => {
    assert.equal(shortNameOf('p_guolu~schedule'), 'schedule');
    assert.equal(shortNameOf('me~main'), 'main');
  });

  it('没有前缀的老 id:短名就是它自己,作用域未知', () => {
    assert.equal(shortNameOf('schedule'), 'schedule');
    assert.equal(scopeOfSheetId('schedule'), null);
  });

  it('从 id 认出作用域', () => {
    assert.deepEqual(scopeOfSheetId('p_guolu~schedule'), { kind: 'project', id: 'guolu' });
    assert.deepEqual(scopeOfSheetId('me~main'), { kind: 'personal' });
    assert.deepEqual(scopeOfSheetId('t_t-42~tmp'), { kind: 'thread', id: 't-42' });
  });

  it('短名里带 ~ 也不会把 id 拆错(只在第一个 ~ 处切)', () => {
    const id = sheetIdFor(PERSONAL_SCOPE, 'a~b');
    assert.equal(shortNameOf(id), 'a~b');
    assert.deepEqual(scopeOfSheetId(id), { kind: 'personal' });
  });

  it('两个项目的同名表,内部 id 不同 —— 这就是 guolu 不再覆盖上重的那一行', () => {
    assert.notEqual(
      sheetIdFor(projectScope('guolu'), 'schedule'),
      sheetIdFor(projectScope('shangzhong'), 'schedule'),
    );
  });
});
