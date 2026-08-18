import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  readCachedThreadProject,
  subscribeThreadProject,
  threadProjectStamp,
  writeCachedThreadProject,
} from './project-sync';

/**
 * 用户实测:在「上重」项目页里说话,对话变成了个人对话 —— 而服务端其实钉对了
 * (e2e 对账:线程钉在 8ec3d03…,正是那个项目)。差的是客户端这一格:
 *
 *  · 输入框在线程刚切过去时就发了一次「这条线程钉在哪」,那时**还没钉**,答 null;
 *  · 钉定随后落地,只写进这个缓存 —— 没有任何人被通知,界面就一直停在"没有项目";
 *  · 更阴的是那个先发的查询**后返回**,还会把已经钉好的值再盖回 null。
 *
 * 所以缓存要能通知,而且要能分辨"我这次查询期间有没有人写过"。
 */
describe('线程→项目 缓存', () => {
  beforeEach(() => {
    writeCachedThreadProject('t1', null);
    writeCachedThreadProject('t2', null);
  });

  it('写入会通知订阅者', () => {
    let hits = 0;
    const off = subscribeThreadProject(() => { hits += 1; });
    writeCachedThreadProject('t1', 'p1');
    off();
    writeCachedThreadProject('t1', 'p2');
    assert.equal(hits, 1, '取消订阅之后不该再收到');
    assert.equal(readCachedThreadProject('t1'), 'p2');
  });

  it('戳记只被同一条线程的写入推进 —— 别的线程写了不该让我丢掉自己的结果', () => {
    const before = threadProjectStamp('t1');
    writeCachedThreadProject('t2', 'p2');
    assert.equal(threadProjectStamp('t1'), before);
    writeCachedThreadProject('t1', 'p1');
    assert.notEqual(threadProjectStamp('t1'), before);
  });

  it('迟到的查询结果按戳记判定是否过期(这就是那个把 null 盖回去的洞)', () => {
    const at = threadProjectStamp('t1');
    writeCachedThreadProject('t1', 'p1');          // 钉定落地
    const stale = threadProjectStamp('t1') !== at; // 查询发出后有人写过
    assert.equal(stale, true);
    assert.equal(readCachedThreadProject('t1'), 'p1');
  });
});
