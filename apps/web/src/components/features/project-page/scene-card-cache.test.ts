/**
 * 场景认知卡:**默认吃缓存,打开时后台核对一次,变了才换,不定时轮询**。
 *
 * 用户定的规矩。背景:服务端每次重算 shangzhong 要 2.7s(已加前置键缓存,降到
 * 0.3s),而前端"每次打开都重取" —— 两头叠起来,每次进项目页都要干等。
 *
 * 这里钉纯逻辑:缓存键怎么定、什么时候算"变了"。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheKeyFor,
  readSceneCardCache,
  writeSceneCardCache,
  clearSceneCardCache,
  entriesDiffer,
} from './scene-card-cache.js';

const spec = { source: 'guolu', server: 'compass', resourceUri: 'ui://card', argsKey: '{"a":1}' };
const entry = (result: unknown) => [{ ...spec, args: { a: 1 }, fetched: { status: 'ready' as const, result } }];

beforeEach(() => clearSceneCardCache());

describe('cacheKeyFor', () => {
  it('同一批卡片同一个键', () => {
    assert.equal(cacheKeyFor('/host', [spec]), cacheKeyFor('/host', [spec]));
  });

  it('换了项目(参数不同)就是另一个键 —— 不能串项目', () => {
    assert.notEqual(
      cacheKeyFor('/host', [spec]),
      cacheKeyFor('/host', [{ ...spec, argsKey: '{"a":2}' }]),
    );
  });

  it('换了 host 也是另一个键', () => {
    assert.notEqual(cacheKeyFor('/host', [spec]), cacheKeyFor('/other', [spec]));
  });
});

describe('缓存读写', () => {
  it('写进去能读出来,并带上写入时间', () => {
    const k = cacheKeyFor('/host', [spec]);
    writeSceneCardCache(k, entry('v1'), new Date('2026-08-15T10:00:00Z'));
    const got = readSceneCardCache(k);
    assert.equal(got?.at, '2026-08-15T10:00:00.000Z');
    assert.equal(got?.entries.length, 1);
  });

  it('没写过就是没有 —— 不返回空数组冒充"没有卡"', () => {
    assert.equal(readSceneCardCache('nope'), undefined);
  });
});

describe('entriesDiffer —— 后台核对完要不要换', () => {
  it('内容一样就不换(避免无谓重渲染/闪烁)', () => {
    assert.equal(entriesDiffer(entry('same'), entry('same')), false);
  });

  it('内容变了就换', () => {
    assert.equal(entriesDiffer(entry('old'), entry('new')), true);
  });

  it('**新结果全是失败时不覆盖旧的** —— 网络抖一下不该把已有的卡清空', () => {
    const failed = [{ ...spec, args: { a: 1 }, fetched: { status: 'error' as const } }];
    assert.equal(entriesDiffer(entry('good'), failed), false);
  });

  it('本来就没有旧的,失败结果照常显示(那是真状态)', () => {
    const failed = [{ ...spec, args: { a: 1 }, fetched: { status: 'error' as const } }];
    assert.equal(entriesDiffer(null, failed), true);
  });
});
