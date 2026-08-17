/**
 * 自动续期:快到期就换一张,用户不该被踢回登录页。
 *
 * 最要紧的两条:
 * - **没到该续的时候不要续**。每次都续等于把轮换变成高频操作,还会让"重用检测"
 *   这类机制更容易被并发绊到。
 * - **续失败不能把已有凭据清掉**。网络抖一下就退出登录,是拿"暂时不通"冒充
 *   "你被登出了"。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { readCompassCredential, writeCompassCredential } from './compass-credential.js';
import { needsRefresh, refreshIfNeeded } from './compass-refresh.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylin-refresh-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const jwt = (secondsFromNow: number) =>
  `x.${Buffer.from(JSON.stringify({ sub: 'u', exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString('base64url')}.y`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('要不要续', () => {
  it('还早就不续 —— 每次都续等于把轮换变成高频操作', () => {
    assert.equal(needsRefresh(jwt(7 * 24 * 3600)), false);
  });

  it('快到期(不足 2 天)就续', () => {
    assert.equal(needsRefresh(jwt(3600)), true);
  });

  it('已经过期也要试一次 —— 也许 refresh 还活着', () => {
    assert.equal(needsRefresh(jwt(-3600)), true);
  });

  it('读不出 exp 的 token 不去续 —— 不猜别人的凭据什么时候到期', () => {
    assert.equal(needsRefresh('not-a-jwt'), false);
  });
});

describe('续期', () => {
  const cred = (exp: number) => ({ url: 'http://c:8000', token: jwt(exp), refreshToken: 'r1' });

  it('换到新的一对并写回', async () => {
    writeCompassCredential(cred(3600), dir);
    const impl = (async () => json({ access_token: jwt(99999), refresh_token: 'r2' })) as unknown as typeof fetch;
    const out = await refreshIfNeeded({ dataDir: dir, clientId: 'cid', fetchImpl: impl });
    assert.equal(out, 'refreshed');
    assert.equal(readCompassCredential(dir)?.refreshToken, 'r2', '轮换出的新票要存下来');
  });

  it('还早就什么也不做', async () => {
    writeCompassCredential(cred(7 * 24 * 3600), dir);
    let called = false;
    const impl = (async () => { called = true; return json({}); }) as unknown as typeof fetch;
    assert.equal(await refreshIfNeeded({ dataDir: dir, clientId: 'cid', fetchImpl: impl }), 'not-needed');
    assert.equal(called, false);
  });

  it('**续失败不清凭据** —— 网络抖一下不等于你被登出了', async () => {
    writeCompassCredential(cred(3600), dir);
    const impl = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    assert.equal(await refreshIfNeeded({ dataDir: dir, clientId: 'cid', fetchImpl: impl }), 'failed');
    assert.ok(readCompassCredential(dir), '凭据必须还在');
  });

  it('对面明确说这张续期凭据不能用了,也不擅自清掉 —— 但要说出来', async () => {
    writeCompassCredential(cred(3600), dir);
    const impl = (async () => json({ error: 'invalid_grant', error_description: '请重新登录' }, 400)) as unknown as typeof fetch;
    assert.equal(await refreshIfNeeded({ dataDir: dir, clientId: 'cid', fetchImpl: impl }), 'needs-login');
    assert.ok(readCompassCredential(dir), '让用户自己决定要不要断开');
  });

  it('没有 refreshToken(手贴的 token)就不去续', async () => {
    writeCompassCredential({ url: 'http://c', token: jwt(3600) }, dir);
    let called = false;
    const impl = (async () => { called = true; return json({}); }) as unknown as typeof fetch;
    assert.equal(await refreshIfNeeded({ dataDir: dir, clientId: 'cid', fetchImpl: impl }), 'not-possible');
    assert.equal(called, false);
  });

  it('没配凭据时安静返回', async () => {
    assert.equal(await refreshIfNeeded({ dataDir: dir, clientId: 'cid' }), 'not-possible');
  });
});
