/**
 * 从 401 找到授权服务器 —— 关键在**不盲信**。
 *
 * 这些地址全部来自被访问的那个服务器自己的响应。它可能是别人给的一个链接、
 * 也可能被劫持;不校验就等于让任何一个 MCP 服务器决定"你去哪儿输密码"。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultResourceMetadataUrl,
  discoverAuthServer,
  endpointUsable,
  resourceMetadataUrl,
  sameOrigin,
} from './mcp-oauth-discovery.js';

describe('从响应头里读出元数据地址', () => {
  it('标准形态', () => {
    assert.equal(
      resourceMetadataUrl('Bearer resource_metadata="https://api.x/.well-known/oauth-protected-resource"'),
      'https://api.x/.well-known/oauth-protected-resource',
    );
  });

  it('没有这个参数就当没有', () => {
    assert.equal(resourceMetadataUrl('Bearer realm="x"'), null);
    assert.equal(resourceMetadataUrl(null), null);
  });
});

describe('端点可用性', () => {
  it('https 可以', () => assert.equal(endpointUsable('https://as.x/authorize'), true));

  it('本机明文可以 —— 开发和桌面回调的现实需要', () => {
    assert.equal(endpointUsable('http://127.0.0.1:8000/oauth/authorize'), true);
  });

  it('**别的明文一律不行** —— 凭据要经过它', () => {
    assert.equal(endpointUsable('http://as.example/authorize'), false);
  });

  it('乱七八糟的地址不行', () => assert.equal(endpointUsable('nonsense'), false));
});

describe('同源判定', () => {
  it('同协议同 host 才算', () => {
    assert.equal(sameOrigin('https://a.x/1', 'https://a.x/2'), true);
    assert.equal(sameOrigin('https://a.x/1', 'https://b.x/2'), false);
    assert.equal(sameOrigin('http://a.x/1', 'https://a.x/2'), false);
  });
});

describe('回退路径', () => {
  it('没有响应头时按 RFC 9728 用资源自己的 well-known', () => {
    assert.equal(
      defaultResourceMetadataUrl('https://api.x/mcp/'),
      'https://api.x/.well-known/oauth-protected-resource',
    );
  });
});

// —— 走完整条发现 ——————————————————————————————————————

const RESOURCE = 'https://api.x/mcp/';

const server = (routes: Record<string, unknown>) =>
  (async (url: string | URL | Request) => {
    const body = routes[String(url)];
    if (body === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

const GOOD_AS = {
  issuer: 'https://api.x',
  authorization_endpoint: 'https://api.x/oauth/authorize',
  token_endpoint: 'https://api.x/oauth/token',
  registration_endpoint: 'https://api.x/oauth/register',
  code_challenge_methods_supported: ['S256'],
};

describe('discoverAuthServer', () => {
  it('顺利时给出三个端点', async () => {
    const out = await discoverAuthServer(RESOURCE, {
      fetchImpl: server({
        'https://api.x/.well-known/oauth-protected-resource': {
          authorization_servers: ['https://api.x'],
        },
        'https://api.x/.well-known/oauth-authorization-server': GOOD_AS,
      }),
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.endpoints.authorizationEndpoint, 'https://api.x/oauth/authorize');
      assert.equal(out.endpoints.registrationEndpoint, 'https://api.x/oauth/register');
    }
  });

  it('**元数据被指向别的站点就拒绝** —— 这是本模块存在的理由', async () => {
    const out = await discoverAuthServer(RESOURCE, {
      wwwAuthenticate: 'Bearer resource_metadata="https://evil.example/.well-known/oauth-protected-resource"',
      fetchImpl: server({}),
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /假的登录页|不予采信/);
  });

  it('同源的响应头照常采信', async () => {
    const out = await discoverAuthServer(RESOURCE, {
      wwwAuthenticate: 'Bearer resource_metadata="https://api.x/.well-known/oauth-protected-resource"',
      fetchImpl: server({
        'https://api.x/.well-known/oauth-protected-resource': { authorization_servers: ['https://api.x'] },
        'https://api.x/.well-known/oauth-authorization-server': GOOD_AS,
      }),
    });
    assert.equal(out.ok, true);
  });

  it('**不支持 S256 就不登** —— 桌面客户端没有别的保护手段', async () => {
    const out = await discoverAuthServer(RESOURCE, {
      fetchImpl: server({
        'https://api.x/.well-known/oauth-protected-resource': { authorization_servers: ['https://api.x'] },
        'https://api.x/.well-known/oauth-authorization-server': {
          ...GOOD_AS, code_challenge_methods_supported: ['plain'],
        },
      }),
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /PKCE/);
  });

  it('登录地址是明文 http(非本机)就拒绝', async () => {
    const out = await discoverAuthServer(RESOURCE, {
      fetchImpl: server({
        'https://api.x/.well-known/oauth-protected-resource': { authorization_servers: ['https://api.x'] },
        'https://api.x/.well-known/oauth-authorization-server': {
          ...GOOD_AS, authorization_endpoint: 'http://api.x/oauth/authorize',
        },
      }),
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /https/);
  });

  it('读不到元数据时说人话,而不是只说失败', async () => {
    const out = await discoverAuthServer(RESOURCE, { fetchImpl: server({}) });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /该去哪里登录/);
  });

  it('元数据里没写授权服务器', async () => {
    const out = await discoverAuthServer(RESOURCE, {
      fetchImpl: server({ 'https://api.x/.well-known/oauth-protected-resource': {} }),
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /没有写授权服务器/);
  });

  it('本机 Compass(http + 127.0.0.1)这条真实路径要走得通', async () => {
    const local = 'http://127.0.0.1:8000/mcp/';
    const out = await discoverAuthServer(local, {
      fetchImpl: server({
        'http://127.0.0.1:8000/.well-known/oauth-protected-resource': {
          authorization_servers: ['http://127.0.0.1:8000'],
        },
        'http://127.0.0.1:8000/.well-known/oauth-authorization-server': {
          issuer: 'http://127.0.0.1:8000',
          authorization_endpoint: 'http://127.0.0.1:8000/oauth/authorize',
          token_endpoint: 'http://127.0.0.1:8000/oauth/token',
          registration_endpoint: 'http://127.0.0.1:8000/oauth/register',
          code_challenge_methods_supported: ['S256'],
        },
      }),
    });
    assert.equal(out.ok, true, out.ok ? '' : out.reason);
  });
});
