import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeDiagnosis,
  getMcpAuthState,
  mcpAuthAction,
  pollMcpFlow,
  startMcpAuth,
} from './mcp-oauth.js';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const fake = (h: (u: string) => Response) =>
  (async (u: string | URL | Request) => h(String(u))) as unknown as typeof fetch;

describe('该显示什么动作', () => {
  it('**没被要求授权时什么也不显示** —— 不给用不上的按钮', () => {
    assert.equal(mcpAuthAction({ authorized: false, needsAuth: false }), null);
  });

  it('对方要授权就给「授权」', () => {
    assert.equal(mcpAuthAction({ authorized: false, needsAuth: true }), 'authorize');
  });

  it('已经授权就给「撤销」', () => {
    assert.equal(mcpAuthAction({ authorized: true, needsAuth: false }), 'revoke');
  });
});

describe('探测', () => {
  it('探不到就当无事发生 —— 网络抖一下不该冒出个按钮', async () => {
    const boom = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    assert.deepEqual(await getMcpAuthState('s', 'https://x', boom), { authorized: false, needsAuth: false });
  });
});

describe('开始授权', () => {
  it('拿到授权链接', async () => {
    const r = await startMcpAuth('s', 'https://x', { fetchImpl: fake(() => json({ flowId: 'f', authorizeUrl: 'https://as/a' })) });
    assert.equal(r.ok, true);
  });

  it('失败时把服务端的原话带出来 —— 那是唯一能查下去的线索', async () => {
    const r = await startMcpAuth('s', 'https://x', { fetchImpl: fake(() =>
      json({ error: '这个授权服务器不支持 PKCE(S256)' }, 502)) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /PKCE/);
  });
});

describe('轮询', () => {
  it('会话没了要说过期,不能一直显示等待中', async () => {
    const s = await pollMcpFlow('gone', fake(() => new Response('{}', { status: 404 })));
    assert.equal(s.status, 'error');
  });
});

describe('连不上时的说法', () => {
  it('问不出来就承认问不出来 —— 不含糊成"连接失败"', () => {
    assert.match(describeDiagnosis(null), /没问出原因/);
  });

  it('401 就直说要授权', () => {
    assert.match(describeDiagnosis({ kind: 'needs-auth', detail: '需要授权 —— 点「授权」。' }), /授权/);
  });

  it('地址通但仍然连不上,也要说出来 —— 这时问题在别处', () => {
    assert.match(describeDiagnosis({ kind: 'ok' }), /握手|凭据/);
  });
});
