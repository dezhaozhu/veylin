import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PanelTab } from '@/components/assistant-ui/right-panel/panel-types';
import {
  SPLIT_RATIO_DEFAULT,
  activateTab,
  clampSplitRatio,
  closeTab,
  moveTabToPane,
  normalizePanelSplit,
  splitLayout,
  visibleTabIds,
  type SplitTabsState,
} from './panel-split';

function tab(id: string, kind: PanelTab['kind'] = 'web'): PanelTab {
  return { id, kind, title: id };
}

function state(overrides: Partial<SplitTabsState> & Pick<SplitTabsState, 'tabs'>): SplitTabsState {
  return { activeId: overrides.tabs[0]?.id ?? null, ...overrides };
}

describe('clampSplitRatio', () => {
  it('clamps to [0.15, 0.85] and defaults non-numbers', () => {
    assert.equal(clampSplitRatio(0.5), 0.5);
    assert.equal(clampSplitRatio(0.01), 0.15);
    assert.equal(clampSplitRatio(0.99), 0.85);
    assert.equal(clampSplitRatio(Number.NaN), SPLIT_RATIO_DEFAULT);
    assert.equal(clampSplitRatio('0.4'), SPLIT_RATIO_DEFAULT);
    assert.equal(clampSplitRatio(undefined), SPLIT_RATIO_DEFAULT);
  });
});

describe('moveTabToPane', () => {
  it('creates a split when moving a tab down', () => {
    const s = state({ tabs: [tab('a', 'table'), tab('b', 'gantt')], activeId: 'a' });
    const next = moveTabToPane(s, 'b', 'bottom');
    assert.deepEqual(next.split?.bottomIds, ['b']);
    assert.equal(next.split?.topVisibleId, 'a');
    assert.equal(next.split?.bottomVisibleId, 'b');
    // 手势语义:注意力跟着被移的页签走。
    assert.equal(next.activeId, 'b');
  });

  it('refuses to split when the moved tab is the only one', () => {
    const s = state({ tabs: [tab('a')], activeId: 'a' });
    assert.equal(moveTabToPane(s, 'a', 'bottom'), s);
  });

  it('refuses to empty the top pane', () => {
    const s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    const withSplit = moveTabToPane(s, 'b', 'bottom');
    // a 是上 pane 唯一页签,移下去会把上 pane 掏空。
    assert.equal(moveTabToPane(withSplit, 'a', 'bottom'), withSplit);
  });

  it('picks a top fallback when the moved tab was top-visible', () => {
    const s = state({ tabs: [tab('a'), tab('b'), tab('c')], activeId: 'b' });
    const next = moveTabToPane(s, 'b', 'bottom');
    assert.equal(next.split?.bottomVisibleId, 'b');
    // b 走了,上 pane 可见页回退到邻居。
    assert.ok(next.split?.topVisibleId === 'a' || next.split?.topVisibleId === 'c');
  });

  it('dissolves the split when the last bottom tab moves up', () => {
    const s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    const withSplit = moveTabToPane(s, 'b', 'bottom');
    const back = moveTabToPane(withSplit, 'b', 'top');
    assert.equal(back.split, undefined);
    assert.equal(back.activeId, 'b');
  });

  it('keeps the split when one of two bottom tabs moves up', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c')], activeId: 'a' });
    s = moveTabToPane(s, 'b', 'bottom');
    s = moveTabToPane(s, 'c', 'bottom');
    assert.deepEqual(s.split?.bottomIds, ['b', 'c']);
    const next = moveTabToPane(s, 'b', 'top');
    assert.deepEqual(next.split?.bottomIds, ['c']);
    assert.equal(next.split?.bottomVisibleId, 'c');
    assert.equal(next.split?.topVisibleId, 'b');
    assert.equal(next.activeId, 'b');
  });

  it('is a no-op for unknown ids and same-pane moves', () => {
    const s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    assert.equal(moveTabToPane(s, 'zzz', 'bottom'), s);
    assert.equal(moveTabToPane(s, 'a', 'top'), s);
    const withSplit = moveTabToPane(s, 'b', 'bottom');
    assert.equal(moveTabToPane(withSplit, 'b', 'bottom'), withSplit);
  });

  it('preserves the ratio across moves', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c')], activeId: 'a' });
    s = moveTabToPane(s, 'b', 'bottom');
    s = { ...s, split: { ...s.split!, ratio: 0.3 } };
    const next = moveTabToPane(s, 'c', 'bottom');
    assert.equal(next.split?.ratio, 0.3);
  });
});

describe('activateTab', () => {
  it('activates within the right pane', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c')], activeId: 'a' });
    s = moveTabToPane(s, 'c', 'bottom');
    const next = activateTab(s, 'b');
    assert.equal(next.activeId, 'b');
    assert.equal(next.split?.topVisibleId, 'b');
    // 下 pane 的可见页不动。
    assert.equal(next.split?.bottomVisibleId, 'c');
  });

  it('activating a bottom tab keeps the top pane as-is', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c')], activeId: 'a' });
    s = moveTabToPane(s, 'b', 'bottom');
    s = moveTabToPane(s, 'c', 'bottom');
    s = activateTab(s, 'a');
    const next = activateTab(s, 'b');
    assert.equal(next.activeId, 'b');
    assert.equal(next.split?.bottomVisibleId, 'b');
    assert.equal(next.split?.topVisibleId, 'a');
  });

  it('ignores unknown ids and no-split states work like before', () => {
    const s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    assert.equal(activateTab(s, 'zzz'), s);
    assert.equal(activateTab(s, 'b').activeId, 'b');
  });
});

describe('closeTab', () => {
  it('falls back within the same pane', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c'), tab('d')], activeId: 'a' });
    s = moveTabToPane(s, 'c', 'bottom');
    s = moveTabToPane(s, 'd', 'bottom');
    // 关掉下 pane 的可见页 d → 回退到同 pane 的 c,不跳去上 pane。
    const next = closeTab(s, 'd');
    assert.equal(next.split?.bottomVisibleId, 'c');
    assert.equal(next.activeId, 'c');
    assert.deepEqual(next.split?.bottomIds, ['c']);
  });

  it('dissolves the split when the bottom pane empties', () => {
    let s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    s = moveTabToPane(s, 'b', 'bottom');
    const next = closeTab(s, 'b');
    assert.equal(next.split, undefined);
    assert.equal(next.activeId, 'a');
    assert.deepEqual(next.tabs.map((t) => t.id), ['a']);
  });

  it('dissolves the split when the top pane empties', () => {
    let s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    s = moveTabToPane(s, 'b', 'bottom');
    const next = closeTab(s, 'a');
    assert.equal(next.split, undefined);
    assert.equal(next.activeId, 'b');
  });

  it('closing a non-visible tab changes no visible ids', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c'), tab('d')], activeId: 'a' });
    s = moveTabToPane(s, 'c', 'bottom');
    s = moveTabToPane(s, 'd', 'bottom');
    s = activateTab(s, 'a');
    const next = closeTab(s, 'c');
    assert.equal(next.activeId, 'a');
    assert.equal(next.split?.topVisibleId, 'a');
    assert.equal(next.split?.bottomVisibleId, 'd');
  });

  it("closing the other pane's visible tab falls back there without moving activeId", () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c'), tab('d')], activeId: 'a' });
    s = moveTabToPane(s, 'c', 'bottom');
    s = moveTabToPane(s, 'd', 'bottom');
    s = activateTab(s, 'd');
    s = activateTab(s, 'a');
    // 现在 active=a(上),下 pane 可见=d。关 d:下 pane 回退 c,active 仍是 a。
    const next = closeTab(s, 'd');
    assert.equal(next.activeId, 'a');
    assert.equal(next.split?.bottomVisibleId, 'c');
  });

  it('without a split behaves like the historical close', () => {
    const s = state({ tabs: [tab('a'), tab('b'), tab('c')], activeId: 'b' });
    const next = closeTab(s, 'b');
    assert.equal(next.split, undefined);
    assert.deepEqual(next.tabs.map((t) => t.id), ['a', 'c']);
    // 历史语义:优先右邻。
    assert.equal(next.activeId, 'c');
  });

  it('ignores unknown ids', () => {
    const s = state({ tabs: [tab('a')], activeId: 'a' });
    assert.equal(closeTab(s, 'zzz'), s);
  });
});

describe('splitLayout / visibleTabIds', () => {
  it('partitions preserving order', () => {
    let s = state({ tabs: [tab('a'), tab('b'), tab('c'), tab('d')], activeId: 'a' });
    s = moveTabToPane(s, 'd', 'bottom');
    s = moveTabToPane(s, 'b', 'bottom');
    const layout = splitLayout(s.tabs, s.split);
    assert.deepEqual(layout.top.map((t) => t.id), ['a', 'c']);
    assert.deepEqual(layout.bottom.map((t) => t.id), ['d', 'b']);
  });

  it('no split → everything on top', () => {
    const s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    const layout = splitLayout(s.tabs, s.split);
    assert.deepEqual(layout.top.map((t) => t.id), ['a', 'b']);
    assert.deepEqual(layout.bottom, []);
  });

  it('visibleTabIds returns one id unsplit, two split', () => {
    let s = state({ tabs: [tab('a'), tab('b')], activeId: 'a' });
    assert.deepEqual(visibleTabIds(s), ['a']);
    s = moveTabToPane(s, 'b', 'bottom');
    assert.deepEqual(visibleTabIds(s).sort(), ['a', 'b']);
    assert.deepEqual(visibleTabIds({ tabs: [], activeId: null }), []);
  });
});

describe('normalizePanelSplit', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];

  it('accepts a valid split', () => {
    const split = normalizePanelSplit(tabs, 'a', {
      bottomIds: ['c'],
      topVisibleId: 'a',
      bottomVisibleId: 'c',
      ratio: 0.4,
    });
    assert.deepEqual(split, {
      bottomIds: ['c'],
      topVisibleId: 'a',
      bottomVisibleId: 'c',
      ratio: 0.4,
    });
  });

  it('drops garbage and non-objects', () => {
    assert.equal(normalizePanelSplit(tabs, 'a', null), undefined);
    assert.equal(normalizePanelSplit(tabs, 'a', 'x'), undefined);
    assert.equal(normalizePanelSplit(tabs, 'a', { bottomIds: 'no' }), undefined);
  });

  it('filters unknown bottom ids; empty pane dissolves', () => {
    assert.equal(
      normalizePanelSplit(tabs, 'a', { bottomIds: ['zzz'], topVisibleId: 'a', bottomVisibleId: 'zzz', ratio: 0.5 }),
      undefined,
    );
    // 全部页签都进了 bottom → 上 pane 空 → 解除。
    assert.equal(
      normalizePanelSplit(tabs, 'a', { bottomIds: ['a', 'b', 'c'], topVisibleId: 'a', bottomVisibleId: 'a', ratio: 0.5 }),
      undefined,
    );
  });

  it('repairs visible ids and aligns with activeId', () => {
    const split = normalizePanelSplit(tabs, 'b', {
      bottomIds: ['c'],
      topVisibleId: 'c', // 不在上 pane → 修
      bottomVisibleId: 'a', // 不在下 pane → 修
      ratio: 9,
    });
    assert.ok(split);
    assert.equal(split.bottomVisibleId, 'c');
    // activeId=b 在上 pane → 上 pane 可见页对齐成 b。
    assert.equal(split.topVisibleId, 'b');
    assert.equal(split.ratio, 0.85);
  });

  it('aligns bottom visible with a bottom activeId', () => {
    const split = normalizePanelSplit([...tabs, tab('d')], 'd', {
      bottomIds: ['c', 'd'],
      topVisibleId: 'a',
      bottomVisibleId: 'c',
      ratio: 0.5,
    });
    assert.equal(split?.bottomVisibleId, 'd');
    assert.equal(split?.topVisibleId, 'a');
  });

  it('dedupes bottomIds', () => {
    const split = normalizePanelSplit(tabs, 'a', {
      bottomIds: ['c', 'c'],
      topVisibleId: 'a',
      bottomVisibleId: 'c',
      ratio: 0.5,
    });
    assert.deepEqual(split?.bottomIds, ['c']);
  });
});
