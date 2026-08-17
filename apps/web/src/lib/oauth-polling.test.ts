import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pollUntilSettled } from './oauth-polling.js';

const noWait = async () => {};

describe('等授权走完', () => {
  it('拿到非 pending 就结束', async () => {
    let n = 0;
    const out = await pollUntilSettled({
      poll: async () => ({ status: ++n < 3 ? 'pending' : 'done' }),
      isPending: (s) => s.status === 'pending',
      isCancelled: () => false,
      wait: noWait,
    });
    assert.deepEqual(out, { kind: 'settled', status: { status: 'done' } });
  });

  it('**取消立刻生效**,不用等这一轮 sleep 完', async () => {
    let polls = 0;
    let cancelled = false;
    const out = await pollUntilSettled({
      poll: async () => { polls += 1; cancelled = true; return { status: 'pending' }; },
      isPending: () => true,
      isCancelled: () => cancelled,
      wait: noWait,
    });
    assert.equal(out.kind, 'cancelled');
    assert.equal(polls, 1, '取消后不该再问第二次');
  });

  it('**取消发生在网络往返期间也算数** —— 否则会把结果写回一个已经关掉的界面', async () => {
    let cancelled = false;
    const seen: string[] = [];
    const out = await pollUntilSettled({
      poll: async () => { cancelled = true; return { status: 'done' }; },
      isPending: (s) => s.status === 'pending',
      isCancelled: () => cancelled,
      onStatus: (s) => seen.push(s.status),
      wait: noWait,
    });
    assert.equal(out.kind, 'cancelled');
    assert.deepEqual(seen, [], '取消之后不该再回写状态');
  });

  it('等太久是一种结束,不是继续等', async () => {
    const out = await pollUntilSettled({
      poll: async () => ({ status: 'pending' }),
      isPending: () => true,
      isCancelled: () => false,
      wait: noWait,
      maxTicks: 3,
    });
    assert.deepEqual(out, { kind: 'timeout' });
  });

  it('每一跳都把状态报出去 —— 界面要能说"在等什么"', async () => {
    const seen: string[] = [];
    await pollUntilSettled({
      poll: async () => ({ status: seen.length < 2 ? 'pending' : 'denied' }),
      isPending: (s) => s.status === 'pending',
      onStatus: (s) => seen.push(s.status),
      isCancelled: () => false,
      wait: noWait,
    });
    assert.deepEqual(seen, ['pending', 'pending', 'denied']);
  });
});
