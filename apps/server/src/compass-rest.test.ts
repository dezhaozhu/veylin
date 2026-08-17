/**
 * 数据面直连(/data/*)的失败要说人话。
 *
 * 背景:同一张过期 token 会让 `/my/sources` 和 `/data/*` 一起 401。身份那条
 * 已经会解释(explain401),这条只吐一个数字 —— 于是同一个原因,人要按两种方式
 * 排查,而且后一种排查不出来。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compassRestBase, fetchCompassData } from './compass-rest.js';

const expiredToken = (sub = 'dev-nategu') =>
  `x.${Buffer.from(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) - 60 }),
  ).toString('base64url')}.y`;

const respondWith = (status: number) =>
  (async () => new Response('{}', { status })) as unknown as typeof fetch;

describe('compassRestBase', () => {
  it('MCP 入口 url 去掉 /mcp/ 就是 REST 根', () => {
    assert.equal(compassRestBase('https://h/mcp/'), 'https://h');
    assert.equal(compassRestBase('https://h/mcp'), 'https://h');
  });
});

describe('401 也要说人话', () => {
  it('数据面 401 带上 token 的解释,而不是只有一个数字', async () => {
    const res = await fetchCompassData(
      { baseUrl: 'http://x', headers: { Authorization: `Bearer ${expiredToken()}` } },
      '/data/work_orders',
      {},
      { fetchImpl: respondWith(401) },
    );
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /过期/);
      assert.match(res.error, /重启/, 'token 是启动时读入的 —— 不说这句人会一直重签');
    }
  });

  it('没有 Authorization 头时不硬解释 —— 没有的东西不编', async () => {
    const res = await fetchCompassData(
      { baseUrl: 'http://x', headers: {} },
      '/data/work_orders',
      {},
      { fetchImpl: respondWith(401) },
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /401/);
  });

  it('其它状态码照旧只报状态 —— 不编造解释', async () => {
    const res = await fetchCompassData(
      { baseUrl: 'http://x', headers: {} },
      '/data/work_orders',
      {},
      { fetchImpl: respondWith(500) },
    );
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /500/);
  });
});
