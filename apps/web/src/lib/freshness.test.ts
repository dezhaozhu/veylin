/**
 * 「上次刷新几分钟前」—— 缓存必须能说出自己有多旧。
 *
 * 这是我们诚实线上最后一个还没露脸的事实:`loadedAt` 一直在存,只有代码知道。
 * 措辞照 honesty-in-user-language 那条:说人话,不摆数字。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeFreshness } from './freshness.js';

const NOW = new Date('2026-08-15T12:00:00Z');

describe('describeFreshness', () => {
  it('刚刚', () => {
    assert.equal(describeFreshness('2026-08-15T11:59:30Z', NOW), '刚刚刷新');
  });

  it('分钟', () => {
    assert.equal(describeFreshness('2026-08-15T11:37:00Z', NOW), '23 分钟前刷新');
  });

  it('小时', () => {
    assert.equal(describeFreshness('2026-08-15T09:00:00Z', NOW), '3 小时前刷新');
  });

  it('天', () => {
    assert.equal(describeFreshness('2026-08-13T12:00:00Z', NOW), '2 天前刷新');
  });

  it('太旧的要**说出来是旧的**,不只是报个数', () => {
    // 一周前的排产缓存拿来当依据,是这条线一路在防的那件事。
    const s = describeFreshness('2026-08-01T12:00:00Z', NOW);
    assert.match(s, /14 天前/);
    assert.match(s, /可能已经过时/);
  });

  it('没有时间戳:说不知道,不猜', () => {
    assert.equal(describeFreshness(undefined, NOW), '刷新时间不详');
  });

  it('时间戳坏掉:同样说不知道', () => {
    assert.equal(describeFreshness('不是时间', NOW), '刷新时间不详');
  });

  it('未来的时间戳(机器时钟不齐)当作刚刚,不显示负数', () => {
    assert.equal(describeFreshness('2026-08-15T12:05:00Z', NOW), '刚刚刷新');
  });
});
