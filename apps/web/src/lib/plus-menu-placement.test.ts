/**
 * 「+」菜单往哪边弹。
 *
 * 从前写死向上(`bottom: innerHeight - rect.top`)—— 聊天页输入框在底部,那是对的。
 * 项目页把同一个输入框搬到了**页面顶部**,菜单就顶出屏幕外:用户看到的是被切掉
 * 半截的一列。同一个组件放到新位置就露馅,说明方向本来就不该写死。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plusMenuPlacement } from './plus-menu-placement';

const rect = (top: number, bottom = top + 32) => ({ top, bottom, left: 20, width: 300 });

describe('plusMenuPlacement', () => {
  it('输入框在底部(聊天页)→ 向上弹,和从前一致', () => {
    const p = plusMenuPlacement(rect(700), 800);
    assert.equal(p.bottom, 800 - 700 + 8);
    assert.equal(p.top, undefined);
  });

  it('**输入框在顶部(项目页)→ 改为向下弹**,不再被切掉', () => {
    const p = plusMenuPlacement(rect(24), 800);
    assert.equal(p.bottom, undefined);
    assert.equal(p.top, 24 + 32 + 8);
  });

  it('**两边都不宽裕时,选空间大的那边**', () => {
    const p = plusMenuPlacement(rect(300), 700); // 上 300 / 下 368
    assert.equal(p.top, 300 + 32 + 8, '上方更挤却仍然向上弹');
  });

  it('**不管往哪弹都给出高度上限** —— 超出就在菜单内部滚,而不是被窗口切掉', () => {
    for (const r of [rect(700), rect(24)]) {
      const p = plusMenuPlacement(r, 800);
      assert.ok(p.maxHeight > 0 && p.maxHeight <= 800, `没有高度上限:${JSON.stringify(p)}`);
    }
  });

  it('左边和宽度照旧跟着按钮,最小 240', () => {
    const p = plusMenuPlacement({ top: 700, bottom: 732, left: 20, width: 100 }, 800);
    assert.equal(p.left, 20);
    assert.equal(p.width, 240);
  });
});
