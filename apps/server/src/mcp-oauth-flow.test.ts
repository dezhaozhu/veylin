/**
 * 通用 MCP 授权的可测部分:探测、注册、换 token。
 *
 * 起真监听那段要真 socket(沙箱里连不上本机回环),靠实机验;这里钉它周围。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exchange, probeNeedsAuth } from './mcp-oauth-flow.js';

const resp = (status: number, headers: Record<string, string> = {}, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const fake = (h: (url: string, init?: RequestInit) => Response) =>
  (async (u: string | URL | Request, init?: RequestInit) => h(String(u), init)) as unknown as typeof fetch;

describe('要不要授权', () => {
  it('401 才算要授权,并把响应头带出来', async () => {
    const out = await probeNeedsAuth('https://api.x/mcp/', fake(() =>
      resp(401, { 'WWW-Authenticate': 'Bearer resource_metadata="https://api.x/.well-known/oauth-protected-resource"' })));
    assert.equal(out.needsAuth, true);
    if (out.needsAuth) assert.match(out.wwwAuthenticate ?? '', /resource_metadata/);
  });

  it('200 当然不用', async () => {
    assert.equal((await probeNeedsAuth('https://api.x/mcp/', fake(() => resp(200)))).needsAuth, false);
  });

  it('**500 不算要授权** —— 否则一台宕机的服务器会不停把人往登录页赶', async () => {
    assert.equal((await probeNeedsAuth('https://api.x/mcp/', fake(() => resp(500)))).needsAuth, false);
  });

  it('连不上也不算 —— 同理', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    assert.equal((await probeNeedsAuth('https://api.x/mcp/', boom)).needsAuth, false);
  });
});

describe('换 token', () => {
  const ep = {
    issuer: 'https://as.x',
    authorizationEndpoint: 'https://as.x/authorize',
    tokenEndpoint: 'https://as.x/token',
  };
  const args = { clientId: 'cid', code: 'c', verifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:5/callback' };

  it('打的是**元数据给的 token 端点**,不是拼出来的路径', async () => {
    let hit = '';
    const out = await exchange(ep, args, fake((u) => { hit = u; return resp(200, {}, { access_token: 'tok' }); }));
    assert.equal(hit, 'https://as.x/token');
    assert.equal(out.accessToken, 'tok');
  });

  it('带回 refresh', async () => {
    const out = await exchange(ep, args, fake(() => resp(200, {}, { access_token: 'a', refresh_token: 'r' })));
    assert.equal(out.refreshToken, 'r');
  });

  it('失败时把对面的话原样带出来', async () => {
    await assert.rejects(
      () => exchange(ep, args, fake(() => resp(400, {}, { error_description: '授权码已经用过了' }))),
      /已经用过/,
    );
  });
});
