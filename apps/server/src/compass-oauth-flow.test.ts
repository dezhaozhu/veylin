/**
 * 注册客户端 / 换 token / 会话表。
 *
 * 起真监听那一段要真 socket,沙箱里连不上本机回环,所以那部分靠实机端到端验;
 * 这里钉的是它周围能被钉住的东西。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  ensureClient,
  exchangeCode,
  readClientRegistration,
  writeClientRegistration,
} from './compass-oauth-flow.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylin-oauth-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fake = (handler: (url: string, init?: RequestInit) => Response) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (u: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(u), init });
    return handler(String(u), init);
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('客户端注册', () => {
  it('登记的回调**不带端口** —— 端口要到运行时才知道', async () => {
    const { impl, calls } = fake(() => json({ client_id: 'cid-1' }, 201));
    await ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { redirect_uris: string[] };
    assert.deepEqual(body.redirect_uris, ['http://127.0.0.1/callback']);
  });

  it('**注册一次就复用** —— 每次登录都注册,会在对面堆出一串一次性客户端', async () => {
    const { impl, calls } = fake(() => json({ client_id: 'cid-1' }, 201));
    await ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl });
    const again = await ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl });
    assert.equal(calls.length, 1, '第二次不该再注册');
    assert.equal(again.clientId, 'cid-1');
  });

  it('换一个 Compass 就是另一个客户端 —— 不能串', async () => {
    const { impl } = fake((u) => json({ client_id: u.includes('8000') ? 'a' : 'b' }, 201));
    const one = await ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl });
    const two = await ensureClient('http://d:9000', { dataDir: dir, fetchImpl: impl });
    assert.notEqual(one.clientId, two.clientId);
  });

  it('注册失败就说清楚,不留下半个状态', async () => {
    const { impl } = fake(() => json({ error: 'invalid_redirect_uri' }, 400));
    await assert.rejects(
      () => ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl }),
      /注册客户端失败/,
    );
    assert.equal(readClientRegistration('http://c:8000', dir), null);
  });

  it('注册记录文件权限 0600', async () => {
    const { impl } = fake(() => json({ client_id: 'cid-1' }, 201));
    await ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl });
    const mode = fs.statSync(path.join(dir, 'compass-oauth-client.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('文件坏了当没注册过,重新注册即可(里面没有不可再生的东西)', async () => {
    fs.writeFileSync(path.join(dir, 'compass-oauth-client.json'), 'garbage');
    const { impl } = fake(() => json({ client_id: 'cid-2' }, 201));
    const reg = await ensureClient('http://c:8000', { dataDir: dir, fetchImpl: impl });
    assert.equal(reg.clientId, 'cid-2');
  });

  it('已有记录不会被新的一条冲掉', () => {
    writeClientRegistration({ baseUrl: 'http://a', clientId: '1' }, dir);
    writeClientRegistration({ baseUrl: 'http://b', clientId: '2' }, dir);
    assert.equal(readClientRegistration('http://a', dir)?.clientId, '1');
  });
});

describe('换 token', () => {
  const args = {
    baseUrl: 'http://c:8000', clientId: 'cid', code: 'the-code',
    verifier: 'v'.repeat(64), redirectUri: 'http://127.0.0.1:5/callback',
  };

  it('按 form 编码发,并带上 verifier', async () => {
    const { impl, calls } = fake(() => json({ access_token: 'tok' }));
    assert.deepEqual(await exchangeCode(args, impl), { accessToken: 'tok' });
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code_verifier'), 'v'.repeat(64));
  });

  it('失败时把对面的话原样带出来 —— 原因只有它知道', async () => {
    const { impl } = fake(() => json({ error_description: '授权码无效、已过期,或已经用过了' }, 400));
    await assert.rejects(() => exchangeCode(args, impl), /已经用过/);
  });

  it('把轮换出来的 refresh 一并带回 —— 漏了就等于下次只能重新登录', async () => {
    const { impl } = fake(() => json({ access_token: 'a', refresh_token: 'r' }));
    assert.deepEqual(await exchangeCode(args, impl), { accessToken: 'a', refreshToken: 'r' });
  });

  it('200 但没有 token 也算失败,不返回 undefined', async () => {
    const { impl } = fake(() => json({}));
    await assert.rejects(() => exchangeCode(args, impl));
  });
});
