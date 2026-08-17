import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  disconnectCompass,
  getCompassCredential,
  normalizeToken,
  saveCompassCredential,
  validateConnectInput,
  startOAuthLogin,
  pollOAuthStatus,
  describeOAuthStatus,
} from './compass-credential.js';

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const fake = (handler: (url: string, init?: RequestInit) => Response) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return handler(u, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('保存凭据', () => {
  it('保存完**立刻同步一次** —— 不让人等十分钟的周期同步', async () => {
    const { impl, calls } = fake(() => ok({ ok: true }));
    const res = await saveCompassCredential({ url: 'http://c:8000', token: 't' }, impl);

    assert.deepEqual(res, { ok: true });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /credential$/);
    assert.match(calls[1].url, /refresh$/);
  });

  it('同步失败不算保存失败 —— 凭据确实写进去了,报成失败会让人重贴一遍', async () => {
    const { impl } = fake((url) => {
      if (url.endsWith('/refresh')) throw new Error('network down');
      return ok({ ok: true });
    });
    assert.deepEqual(await saveCompassCredential({ url: 'http://c', token: 't' }, impl), { ok: true });
  });

  it('保存失败时把服务端的话原样带出来', async () => {
    const { impl } = fake(() => new Response(JSON.stringify({ error: 'url 必须是 http(s)' }), { status: 400 }));
    const res = await saveCompassCredential({ url: 'file:///x', token: 't' }, impl);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /http/);
  });

  it('前后空白去掉再发 —— 从终端复制几乎必然带换行', async () => {
    const { impl, calls } = fake(() => ok({ ok: true }));
    await saveCompassCredential({ url: ' http://c ', token: ' t\n' }, impl);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { url: 'http://c', token: 't' });
  });
});

describe('读取与断开', () => {
  it('没配就是没配', async () => {
    const { impl } = fake(() => ok({ configured: false }));
    assert.deepEqual(await getCompassCredential(impl), { configured: false });
  });

  it('断开之后也同步一次 —— 否则界面上那些数据源还挂着', async () => {
    const { impl, calls } = fake(() => ok({ ok: true }));
    await disconnectCompass(impl);
    assert.match(calls[1].url, /refresh$/);
  });
});

describe('贴进来的东西先看一眼', () => {
  it('整段 Bearer 一起复制是最常见的手滑 —— 替他去掉并说一声', () => {
    const out = normalizeToken('Bearer eyJhbGciOi');
    assert.equal(out.token, 'eyJhbGciOi');
    assert.match(out.note ?? '', /Bearer/);
  });

  it('正常 token 不加戏', () => {
    assert.deepEqual(normalizeToken(' eyJabc \n'), { token: 'eyJabc' });
  });

  it('地址不对时说人话,而不是等服务端回一个数字', () => {
    assert.match(validateConnectInput('不是地址', 't') ?? '', /http/);
    assert.match(validateConnectInput('file:///x', 't') ?? '', /http/);
    assert.match(validateConnectInput('', 't') ?? '', /地址/);
    assert.match(validateConnectInput('http://c', '') ?? '', /token/);
  });

  it('都对就没有话说', () => {
    assert.equal(validateConnectInput('http://127.0.0.1:8000', 'tok'), null);
  });
});

describe('用浏览器登录', () => {
  it('开始登录拿到授权链接和 flowId', async () => {
    const { impl } = fake(() => ok({ flowId: 'f1', authorizeUrl: 'http://c/oauth/authorize?x=1' }));
    const res = await startOAuthLogin('http://c:8000', impl);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.start.flowId, 'f1');
  });

  it('开始失败时把服务端的话带出来 —— 多半是地址写错或那台 Compass 太旧', async () => {
    const { impl } = fake(() => new Response(JSON.stringify({ error: '注册客户端失败' }), { status: 502 }));
    const res = await startOAuthLogin('http://c:8000', impl);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /注册客户端失败/);
  });

  it('**会话没了要说过期,不能一直显示等待中**', async () => {
    const { impl } = fake(() => new Response('{}', { status: 404 }));
    const s = await pollOAuthStatus('gone', impl);
    assert.equal(s.status, 'error');
    if (s.status === 'error') assert.match(s.error, /过期/);
  });

  it('拒绝是一种正常结果,措辞不该像出错', () => {
    assert.match(describeOAuthStatus({ status: 'denied' }), /拒绝/);
    assert.doesNotMatch(describeOAuthStatus({ status: 'denied' }), /失败|错误/);
  });

  it('等待中的话要说清楚在等什么', () => {
    assert.match(describeOAuthStatus({ status: 'pending' }), /浏览器/);
  });
});
