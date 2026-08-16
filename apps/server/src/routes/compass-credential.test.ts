/**
 * 「连接 Compass」这条路由:贴一张 token → 立刻生效 → 界面能说出连的是谁。
 *
 * 这条路由存在的理由是一次真实故障:凭据在 `.env` 里、进程启动时读一次,换了
 * 之后 401 照旧。所以下面最要紧的一条断言是 **PUT 完不重启就能读到新的**。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import Fastify from 'fastify';

import { registerCompassCredentialRoutes } from './compass-credential.js';
import { readCompassCredential } from '../compass-credential.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylin-credroute-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const build = () => {
  const app = Fastify();
  registerCompassCredentialRoutes(app, { dataDir: () => dir });
  return app;
};

describe('GET /api/compass-identity/credential', () => {
  it('没配就说没配', async () => {
    const res = await build().inject({ method: 'GET', url: '/api/compass-identity/credential' });
    assert.deepEqual(res.json(), { configured: false });
  });

  it('配了就报 url 和**遮住的** token —— 绝不回传原文', async () => {
    fs.writeFileSync(path.join(dir, 'compass-identity.json'),
      JSON.stringify({ url: 'http://c:8000', token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' }));
    const body = (await build().inject({ method: 'GET', url: '/api/compass-identity/credential' })).json();

    assert.equal(body.configured, true);
    assert.equal(body.url, 'http://c:8000');
    assert.ok(!JSON.stringify(body).includes('payload'), '原文不能出网关');
    assert.match(body.tokenMasked, /^eyJhbG/, '留头,好让人认出是不是自己贴的那张');
  });
});

describe('PUT /api/compass-identity/credential', () => {
  it('**贴完立刻生效,不用重启** —— 这是整条路由存在的理由', async () => {
    const res = await build().inject({
      method: 'PUT', url: '/api/compass-identity/credential',
      payload: { url: 'http://c:8000', token: 'tok-new' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(readCompassCredential(dir)?.token, 'tok-new');
  });

  it('缺 url 或 token 就拒,并说清缺什么', async () => {
    const res = await build().inject({
      method: 'PUT', url: '/api/compass-identity/credential', payload: { url: 'http://c' },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /token/);
  });

  it('url 不是 http(s) 就拒 —— 别让凭据发去一个奇怪的协议', async () => {
    const res = await build().inject({
      method: 'PUT', url: '/api/compass-identity/credential',
      payload: { url: 'file:///etc/passwd', token: 'x' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('token 前后的空白自动去掉 —— 从终端复制几乎必然带换行', async () => {
    await build().inject({
      method: 'PUT', url: '/api/compass-identity/credential',
      payload: { url: 'http://c:8000', token: '  tok-with-space\n' },
    });
    assert.equal(readCompassCredential(dir)?.token, 'tok-with-space');
  });
});

describe('DELETE /api/compass-identity/credential', () => {
  it('断开之后就是没配', async () => {
    fs.writeFileSync(path.join(dir, 'compass-identity.json'),
      JSON.stringify({ url: 'http://c', token: 'tok' }));
    const res = await build().inject({ method: 'DELETE', url: '/api/compass-identity/credential' });
    assert.equal(res.statusCode, 200);
    assert.equal(readCompassCredential(dir), null);
  });

  it('本来就没有也不报错 —— 断开是个想要的状态,不是一次操作', async () => {
    const res = await build().inject({ method: 'DELETE', url: '/api/compass-identity/credential' });
    assert.equal(res.statusCode, 200);
  });
});
