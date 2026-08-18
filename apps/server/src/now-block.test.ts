/**
 * 见 now-block.ts:不给当前时间,模型会把"今天"写成训练时的日期(实测 2025-01-09,
 * 而真实是 2026-08-17),整列日期错得看不出来。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatNowBlock } from './now-block.js';

describe('formatNowBlock', () => {
  const t = new Date('2026-08-17T00:12:00Z'); // 上海 08:12 周一

  it('**给出日期、星期、时刻和时区**', () => {
    const s = formatNowBlock(t, 'Asia/Shanghai');
    assert.match(s, /2026-08-17/);
    assert.match(s, /周一/);
    assert.match(s, /08:12/);
    assert.match(s, /Asia\/Shanghai/);
  });

  it('**按本地时区换算** —— 排产里的"今天"是本地语义,不是 UTC', () => {
    // 同一时刻在洛杉矶还是 16 日下午。
    assert.match(formatNowBlock(t, 'America/Los_Angeles'), /2026-08-16/);
    assert.match(formatNowBlock(t, 'Asia/Shanghai'), /2026-08-17/);
  });

  it('**明说别用训练时的日期** —— 只给一个时间戳,模型仍可能拿旧日期算', () => {
    assert.match(formatNowBlock(t, 'UTC'), /不要用你训练时/);
  });

  it('时区缺失时退回本机时区,不抛错', () => {
    assert.match(formatNowBlock(t), /当前时间/);
  });
});
