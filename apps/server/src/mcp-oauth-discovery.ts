/**
 * 从一次 401 找到"该去哪儿登录"(RFC 9728 + RFC 8414)。
 *
 * 通用授权的第一步:MCP 服务器被访问时回 401,并在 `WWW-Authenticate` 里指出
 * 自己的受保护资源元数据;元数据里写着授权服务器是谁;再去读授权服务器的元数据,
 * 拿到 authorize / token / 动态注册三个端点。之后就是我们已经有的那套
 * 授权码 + PKCE。
 *
 * 这一层的价值全在**不盲信**上,三条:
 *
 * 1. **元数据地址必须和资源同源。** 这个地址来自服务器自己的响应头 —— 一个恶意
 *    (或被劫持的)服务器可以指向任意地方,把用户引到一个假登录页去骗凭据。
 *    RFC 9728 为此要求校验同源;我们照做。
 * 2. **端点必须是 https,本机除外。** 凭据要经过它们。本机明文是开发/桌面回调的
 *    现实需要,别的没有理由。
 * 3. **授权服务器必须支持 S256。** 公有客户端没有 secret,PKCE 是唯一的保护;
 *    对面不支持就**拒绝登录**,而不是退化成没有保护还照常连上。
 */
export type AuthServerEndpoints = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
};

export type DiscoveryFailure = { ok: false; reason: string };
export type DiscoveryResult = { ok: true; endpoints: AuthServerEndpoints } | DiscoveryFailure;

/** `WWW-Authenticate: Bearer resource_metadata="https://…"` → 那个地址。 */
export function resourceMetadataUrl(header: string | null): string | null {
  if (!header) return null;
  const m = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  return m?.[1] ?? null;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** 凭据要经过它 —— 非本机必须 https。 */
export function endpointUsable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && isLoopback(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 元数据地址是不是和资源同源。
 *
 * 这条是本模块最要紧的一条:地址来自服务器自己的响应头,不校验就等于让任何一个
 * 服务器把用户引到它指定的"登录页"。
 */
export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

/**
 * `.well-known` 地址的几种拼法,按该试的顺序。
 *
 * **实测出来的**:RFC 8414 §3.1 / RFC 9728 §3 规定 well-known 段要**插在 host 和
 * path 之间**(`https://h/.well-known/xxx/some/path`),但现实里"直接拼在后面"
 * (`https://h/some/path/.well-known/xxx`)和根路径两种也都有服务器在用。
 *
 * 一开始我只拼了根路径 —— GitHub(issuer 带路径 `/login/oauth`)和 Sentry
 * (资源元数据只在 `/.well-known/oauth-protected-resource/mcp/`)就都发现不了。
 */
function wellKnownCandidates(base: string, name: string): string[] {
  const u = new URL(base);
  const path = u.pathname.replace(/\/+$/, '');
  const root = `${u.origin}/.well-known/${name}`;
  if (!path) return [root];
  return [
    `${u.origin}/.well-known/${name}${path}`,   // 规范形态
    `${u.origin}${path}/.well-known/${name}`,   // 现实里也常见
    root,
  ];
}

export function resourceMetadataCandidates(resourceUrl: string): string[] {
  return wellKnownCandidates(resourceUrl, 'oauth-protected-resource');
}

export function authServerMetadataCandidates(issuer: string): string[] {
  return wellKnownCandidates(issuer, 'oauth-authorization-server');
}

/** 没有 WWW-Authenticate 时的回退(取最规范的那一个,用于同源校验)。 */
export function defaultResourceMetadataUrl(resourceUrl: string): string {
  const u = new URL(resourceUrl);
  return `${u.origin}/.well-known/oauth-protected-resource`;
}

async function getJson(url: string, f: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const res = await f(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 走完发现:资源 URL(+ 可选的 401 响应头)→ 三个端点。
 *
 * 任何一步不过都返回**说得清原因**的失败 —— 这条路上的每一次失败,用户看到的
 * 都只是"连不上",能不能查下去全看这句话。
 */
export async function discoverAuthServer(
  resourceUrl: string,
  opts: { wwwAuthenticate?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<DiscoveryResult> {
  const f = opts.fetchImpl ?? fetch;
  const declared = resourceMetadataUrl(opts.wwwAuthenticate ?? null);
  // 服务器**明说了**就只用它(并校验同源);没说才按几种拼法去试。
  const candidates = declared ? [declared] : resourceMetadataCandidates(resourceUrl);

  const offsite = candidates.find((u) => !sameOrigin(u, resourceUrl));
  if (offsite) {
    return {
      ok: false,
      reason: `这个服务器把授权信息指向了另一个站点(${new URL(offsite).origin}),不予采信 —— 否则它可以把你引到一个假的登录页。`,
    };
  }

  let resourceMeta: Record<string, unknown> | null = null;
  for (const u of candidates) {
    resourceMeta = await getJson(u, f);
    if (resourceMeta) break;
  }
  if (!resourceMeta) {
    return { ok: false, reason: '这个服务器要求授权,但没有说明该去哪里登录(读不到它的授权元数据)。' };
  }
  const servers = resourceMeta.authorization_servers;
  const issuer = Array.isArray(servers) && typeof servers[0] === 'string' ? servers[0] : null;
  if (!issuer) {
    return { ok: false, reason: '这个服务器的授权元数据里没有写授权服务器。' };
  }

  let asMeta: Record<string, unknown> | null = null;
  for (const u of authServerMetadataCandidates(issuer)) {
    asMeta = await getJson(u, f);
    if (asMeta) break;
  }
  if (!asMeta) {
    return { ok: false, reason: `读不到授权服务器(${issuer})的元数据。` };
  }

  const authorizationEndpoint = String(asMeta.authorization_endpoint ?? '');
  const tokenEndpoint = String(asMeta.token_endpoint ?? '');
  const registrationEndpoint =
    typeof asMeta.registration_endpoint === 'string' ? asMeta.registration_endpoint : undefined;

  if (!endpointUsable(authorizationEndpoint) || !endpointUsable(tokenEndpoint)) {
    return { ok: false, reason: '授权服务器的登录地址不是 https(本机除外),不能把凭据交给它。' };
  }

  const methods = asMeta.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes('S256')) {
    // 不退化:桌面客户端存不住 secret,PKCE 是唯一的保护。对面不支持就不登。
    return {
      ok: false,
      reason: '这个授权服务器不支持 PKCE(S256)。桌面客户端没有别的保护手段,不能这样登录。',
    };
  }

  return {
    ok: true,
    endpoints: {
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      ...(registrationEndpoint ? { registrationEndpoint } : {}),
    },
  };
}
