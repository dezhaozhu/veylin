/**
 * 契约:**Compass 真回什么形状,我们就得认什么形状。**
 *
 * 起因是一个不会有任何报错的 bug:compass 回的是 `rows` + `equipment[].resource`,
 * 我这边写的是 `eligibility` + `equipment[].name` —— 两边各自的单测都全绿,
 * 接起来一条事实也认不出来,而且悄无声息。替身测不出这个,因为替身是我照着
 * 自己的假设写的。
 *
 * 所以这条**打真 Compass**。连不上就跳过并说清楚 —— 静默绿等于没有这条测试。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { factsFromCompass } from './doc-assertions.js';

/** 从 .env 里的 VEYLIN_COMPASS_IDENTITY 取 url+token(与运行时同一份配置)。 */
function identity(): { url: string; token: string } | null {
  const raw = process.env.VEYLIN_COMPASS_IDENTITY;
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { url?: string; token?: string };
    return d.url && d.token ? { url: d.url, token: d.token } : null;
  } catch {
    return null;
  }
}

async function callTool(id: { url: string; token: string }, name: string, args: unknown) {
  const res = await fetch(`${id.url.replace(/\/$/, '')}/mcp/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${id.token}`,
      'x-compass-source': 'shangzhong',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  const m = /"structuredContent":(\{[\s\S]*?\})(?=,"isError"|\}\s*$)/.exec(text)
    ?? /"text":"(\{[\s\S]*?\})"/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!.replace(/\\"/g, '"').replace(/\\n/g, '\n')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('Compass 契约:get_op_eligibility', () => {
  it('**真回参能被 factsFromCompass 认出来**', async (t) => {
    const id = identity();
    if (!id) {
      t.skip('没有 VEYLIN_COMPASS_IDENTITY —— 这条契约测试需要真 Compass');
      return;
    }
    let out: Record<string, unknown> | null = null;
    try {
      out = await callTool(id, 'get_op_eligibility', { ops: ['性能热处理'], limit: 5 });
    } catch (err) {
      t.skip(`连不上 Compass(${String(err).slice(0, 60)}) —— 跳过契约测试`);
      return;
    }
    if (!out) {
      t.skip('Compass 没回可解析的结果 —— 跳过');
      return;
    }

    // 形状要点:rows[].op_code / op_name / flexibility / equipment[].resource+share
    assert.ok(Array.isArray(out.rows), `回参里没有 rows:${Object.keys(out).join(',')}`);
    const facts = factsFromCompass(out as never);
    assert.ok(
      facts.length > 0,
      `**认不出来** —— 这正是当初 equipment[].resource vs name 那个 bug 的形状。回参键:` +
        JSON.stringify(out).slice(0, 300),
    );
    const first = facts[0]!;
    assert.equal(first.kind, 'op_resource');
    if (first.kind === 'op_resource') {
      assert.ok(first.resources.length > 0, '资源列表是空的');
      assert.ok(first.resources[0]!.name, '资源没有名字 —— 字段名可能又对不上了');
    }
  });
});
