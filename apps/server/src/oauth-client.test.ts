import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';

import {
  authorizeUrl,
  callbackPage,
  createPkce,
  createState,
  readCallback,
} from './oauth-client.js';

describe('PKCE', () => {
  it('challenge 确实是 verifier 的 S256(否则服务端永远说对不上)', () => {
    const { verifier, challenge } = createPkce();
    const expect = crypto.createHash('sha256').update(verifier).digest().toString('base64url');
    assert.equal(challenge, expect);
  });

  it('verifier 长度在 RFC 7636 的 43–128 之内', () => {
    const { verifier } = createPkce();
    assert.ok(verifier.length >= 43 && verifier.length <= 128, `实为 ${verifier.length}`);
  });

  it('每次都不一样 —— PKCE 的全部安全性都在"猜不到"上', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createPkce().verifier));
    assert.equal(seen.size, 50);
  });

  it('base64url,不带填充', () => {
    const { verifier, challenge } = createPkce();
    for (const s of [verifier, challenge]) {
      assert.doesNotMatch(s, /[+/=]/);
    }
  });
});

describe('授权链接', () => {
  const p = {
    authorizationEndpoint: 'http://127.0.0.1:8000/oauth/authorize',
    clientId: 'cid',
    redirectUri: 'http://127.0.0.1:51234/callback',
    challenge: 'CH',
    state: 'ST',
  };

  it('该带的都带上,并声明 S256', () => {
    const u = new URL(authorizeUrl(p));
    assert.equal(u.pathname, '/oauth/authorize');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('client_id'), 'cid');
    assert.equal(u.searchParams.get('state'), 'ST');
  });

  it('回调地址会被正确编码 —— 拼字符串最容易在这里出错', () => {
    const u = new URL(authorizeUrl(p));
    assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:51234/callback');
  });

  it('授权端点原样使用 —— 通用路径下它来自对方元数据,拼路径猜是错的', () => {
    const u = new URL(authorizeUrl({ ...p, authorizationEndpoint: 'https://as.x/custom/authz' }));
    assert.equal(u.origin + u.pathname, 'https://as.x/custom/authz');
  });
});

describe('回调判定', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('state 对得上且有码 → 拿到码', () => {
    const out = readCallback(q('code=abc&state=ST'), 'ST');
    assert.deepEqual(out, { kind: 'code', code: 'abc' });
  });

  it('**state 对不上一律不认** —— 否则别人塞来的授权码会被我们换成 token 存下来', () => {
    const out = readCallback(q('code=abc&state=OTHER'), 'ST');
    assert.equal(out.kind, 'error');
  });

  it('没带 state 也不认', () => {
    assert.equal(readCallback(q('code=abc'), 'ST').kind, 'error');
  });

  it('错误信息不回显对方的 state —— 那是在帮它对齐', () => {
    const out = readCallback(q('code=abc&state=GUESS'), 'SECRET');
    if (out.kind === 'error') {
      assert.ok(!out.message.includes('GUESS'));
      assert.ok(!out.message.includes('SECRET'));
    }
  });

  it('用户点了拒绝,是一种正常结果,不是错误', () => {
    assert.deepEqual(readCallback(q('error=access_denied&state=ST'), 'ST'), { kind: 'denied' });
  });

  it('其它错误原样带出来', () => {
    const out = readCallback(q('error=server_error&state=ST'), 'ST');
    assert.equal(out.kind, 'error');
  });

  it('state 对但没码也不认', () => {
    assert.equal(readCallback(q('state=ST'), 'ST').kind, 'error');
  });
});

describe('回调落地页', () => {
  it('会转义 —— 页面内容来自 URL,不能直接塞进 HTML', () => {
    const html = callbackPage('<script>x</script>', 'a & b');
    assert.ok(!html.includes('<script>x</script>'));
    assert.ok(html.includes('&amp;'));
  });
});
