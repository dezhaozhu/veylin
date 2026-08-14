/**
 * SSE 也按作用域过滤(spec 2026-08-13 §7 记的那条未做)。
 *
 * 客户端按作用域化的 sheet id 取数,所以拿不到别的作用域的**数据**;但事件本身
 * 会漏出"别的作用域有一张叫某某的表变了"这点元信息。既然归属这条线的规矩是
 * "不在作用域里就当它不存在",那推送也该守同一条。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eventVisibleInScope } from './table-event-scope.js';
import { PERSONAL_SCOPE, projectScope, sheetIdFor } from './table-scope.js';

const GUOLU = projectScope('guolu');
const SZ = projectScope('shangzhong');
const row = (sheet: string) => ({ type: 'rowUpsert' as const, sheet, row: { row_id: 'r1' } });

describe('eventVisibleInScope', () => {
  it('本作用域的表变了 → 推', () => {
    assert.equal(eventVisibleInScope(row(sheetIdFor(GUOLU, 'schedule')), GUOLU), true);
  });

  it('别的项目的表变了 → 不推', () => {
    assert.equal(eventVisibleInScope(row(sheetIdFor(SZ, 'schedule')), GUOLU), false);
  });

  it('个人区的表变了,项目会话不推;反过来也不推', () => {
    assert.equal(eventVisibleInScope(row(sheetIdFor(PERSONAL_SCOPE, 'main')), GUOLU), false);
    assert.equal(eventVisibleInScope(row(sheetIdFor(GUOLU, 'schedule')), PERSONAL_SCOPE), false);
  });

  it('sheetsChange 没有 sheet 字段 → 照推(它只是让客户端重取,而重取本身是按作用域的)', () => {
    assert.equal(eventVisibleInScope({ type: 'sheetsChange' }, GUOLU), true);
  });

  it('认不出作用域的老 id → 照推,不猜', () => {
    // 迁移前的裸 id 不该因为"看不出归属"就被静默吞掉。
    assert.equal(eventVisibleInScope(row('schedule'), GUOLU), true);
  });
});
