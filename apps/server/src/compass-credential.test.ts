/**
 * Compass 凭据的存放:文件 + **用的时候才读**。
 *
 * 起因是一次真实故障:token 过期,换了 .env 里的新值,401 照旧 —— 因为
 * `process.env` 在进程启动那一刻就定死了,一个跑了 14 小时的 dev 进程手里
 * 还是旧的那张。人会以为自己签错了,再签一次,还是不通。
 *
 * 所以这里的核心性质只有一条:**存进去之后,不重启就能生效**。
 *
 * 诚实边界:这不是系统钥匙串。它防的是"凭据躺在仓库的 .env 里",防不了同一个
 * 用户身份下的其它进程 —— 那需要钥匙串,而 server 是 Tauri 的 sidecar 独立进程,
 * 由 Rust 端读钥匙串再传过来又会退回"启动时读一次"。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  clearCompassCredential,
  credentialPath,
  maskToken,
  readCompassCredential,
  resolveCompassIdentity,
  writeCompassCredential,
} from './compass-credential.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylin-cred-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cred = { url: 'http://127.0.0.1:8000', token: 'tok-abc' };

describe('存取', () => {
  it('写进去能读出来', () => {
    writeCompassCredential(cred, dir);
    assert.deepEqual(readCompassCredential(dir), cred);
  });

  it('没写过就是没有 —— 不返回一个空壳冒充已配置', () => {
    assert.equal(readCompassCredential(dir), null);
  });

  it('**换一张之后立刻生效,不用重启** —— 这就是这个模块存在的理由', () => {
    writeCompassCredential(cred, dir);
    writeCompassCredential({ ...cred, token: 'tok-new' }, dir);
    assert.equal(readCompassCredential(dir)?.token, 'tok-new');
  });

  it('清掉之后就是没有', () => {
    writeCompassCredential(cred, dir);
    clearCompassCredential(dir);
    assert.equal(readCompassCredential(dir), null);
  });

  it('文件只有本人可读写(0600)', () => {
    writeCompassCredential(cred, dir);
    const mode = fs.statSync(credentialPath(dir)).mode & 0o777;
    assert.equal(mode, 0o600, `凭据文件权限应为 600,实为 ${mode.toString(8)}`);
  });

  it('文件坏了当作没有,不让整个应用起不来', () => {
    fs.writeFileSync(credentialPath(dir), 'not json');
    assert.equal(readCompassCredential(dir), null);
  });

  it('缺 url 或 token 都算无效 —— 半份凭据比没有更难查', () => {
    fs.writeFileSync(credentialPath(dir), JSON.stringify({ url: 'http://x' }));
    assert.equal(readCompassCredential(dir), null);
  });
});

describe('resolveCompassIdentity —— 文件优先,env 兜底', () => {
  it('有文件就用文件', () => {
    writeCompassCredential(cred, dir);
    const got = resolveCompassIdentity(dir, { VEYLIN_COMPASS_IDENTITY: '{"url":"http://env","token":"env-tok"}' });
    assert.equal(got?.token, 'tok-abc');
  });

  it('没文件就退回 env —— 老部署和 dev 不受影响', () => {
    const got = resolveCompassIdentity(dir, { VEYLIN_COMPASS_IDENTITY: '{"url":"http://env","token":"env-tok"}' });
    assert.equal(got?.token, 'env-tok');
  });

  it('两个都没有就是没配 —— 功能整体静默关闭,不报错', () => {
    assert.equal(resolveCompassIdentity(dir, {}), null);
  });
});

describe('maskToken —— 要能对得上,又不能泄露', () => {
  it('只留头尾', () => {
    const masked = maskToken('eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.sig');
    assert.ok(!masked.includes('abcdefghijklmnop'), '中间不能露');
    assert.match(masked, /^eyJhbG/, '留头,好让人确认是不是自己贴的那张');
    assert.match(masked, /sig$/, '留尾同理');
  });

  it('太短的一律全遮 —— 短到留头尾就等于没遮', () => {
    assert.ok(!maskToken('abcdefgh').includes('abcdefgh'));
  });
});
