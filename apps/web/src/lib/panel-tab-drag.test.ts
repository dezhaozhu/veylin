import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DRAG_THRESHOLD_PX,
  exceedsDragThreshold,
  resolveDropTarget,
} from './panel-tab-drag';

const rect = { top: 100, height: 400 } as const;

describe('exceedsDragThreshold', () => {
  it('ignores jitter, triggers past the threshold in any direction', () => {
    assert.equal(exceedsDragThreshold(0, 0), false);
    assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX - 1, 0), false);
    assert.equal(exceedsDragThreshold(0, -DRAG_THRESHOLD_PX), true);
    assert.equal(exceedsDragThreshold(DRAG_THRESHOLD_PX, 0), true);
  });
});

describe('resolveDropTarget — 未分屏', () => {
  const base = { rect, splitRatio: null, from: 'top' as const, topTabCount: 3 };

  it('拖到下半 → 建分屏,预览是下半块', () => {
    const t = resolveDropTarget({ ...base, pointerY: 400 });
    assert.equal(t?.pane, 'bottom');
    assert.equal(t?.creates, true);
    assert.deepEqual(t?.band, { start: 0.5, end: 1 });
  });

  it('拖到上半 = 什么都不会变 → 不给落点(不亮预览)', () => {
    assert.equal(resolveDropTarget({ ...base, pointerY: 150 }), null);
  });

  it('上 pane 只剩这一个页签时,下半也不给落点 —— 上 pane 不许被掏空', () => {
    assert.equal(resolveDropTarget({ ...base, topTabCount: 1, pointerY: 400 }), null);
  });

  it('指针在面板外 → 没有落点', () => {
    assert.equal(resolveDropTarget({ ...base, pointerY: 50 }), null);
    assert.equal(resolveDropTarget({ ...base, pointerY: 600 }), null);
  });
});

describe('resolveDropTarget — 已分屏', () => {
  // ratio 0.4 ⇒ 边界在 100 + 160 = 260
  const base = { rect, splitRatio: 0.4, topTabCount: 2 };

  it('从上拖到下 pane', () => {
    const t = resolveDropTarget({ ...base, from: 'top', pointerY: 300 });
    assert.equal(t?.pane, 'bottom');
    assert.equal(t?.creates, false);
    assert.deepEqual(t?.band, { start: 0.4, end: 1 });
  });

  it('从下拖到上 pane', () => {
    const t = resolveDropTarget({ ...base, from: 'bottom', pointerY: 200 });
    assert.equal(t?.pane, 'top');
    assert.deepEqual(t?.band, { start: 0, end: 0.4 });
  });

  it('拖回自己那个 pane → 无落点', () => {
    assert.equal(resolveDropTarget({ ...base, from: 'top', pointerY: 200 }), null);
    assert.equal(resolveDropTarget({ ...base, from: 'bottom', pointerY: 300 }), null);
  });

  it('上 pane 只剩一个页签时不许拖下去(会掏空上 pane)', () => {
    assert.equal(
      resolveDropTarget({ ...base, from: 'top', topTabCount: 1, pointerY: 300 }),
      null,
    );
  });

  it('从下往上搬不受 topTabCount 限制 —— 那是在填充上 pane,不是掏空', () => {
    const t = resolveDropTarget({ ...base, from: 'bottom', topTabCount: 1, pointerY: 200 });
    assert.equal(t?.pane, 'top');
  });

  it('边界线上算下 pane(与渲染一致:上 pane 高度 = ratio × 高)', () => {
    assert.equal(resolveDropTarget({ ...base, from: 'top', pointerY: 260 })?.pane, 'bottom');
    assert.equal(resolveDropTarget({ ...base, from: 'top', pointerY: 259 }), null);
  });

  it('零高度容器不崩,也不给落点', () => {
    assert.equal(
      resolveDropTarget({ ...base, rect: { top: 100, height: 0 }, from: 'top', pointerY: 100 }),
      null,
    );
  });
});
