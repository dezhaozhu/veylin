import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  clearMcpCredential,
  hasMcpCredential,
  readMcpCredential,
  writeMcpCredential,
} from './mcp-credentials.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veylin-mcpcred-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const cred = (t = 'tok') => ({ issuer: 'https://as.x', clientId: 'cid', accessToken: t });

describe('每个服务器一份', () => {
  it('写进去能读出来', () => {
    writeMcpCredential('srv-1', cred(), dir);
    assert.equal(readMcpCredential('srv-1', dir)?.accessToken, 'tok');
  });

  it('**互不串** —— 两家共用一张 token 等于把授权也给了另一家,而且是静默的', () => {
    writeMcpCredential('srv-1', cred('a'), dir);
    writeMcpCredential('srv-2', cred('b'), dir);
    assert.equal(readMcpCredential('srv-1', dir)?.accessToken, 'a');
    assert.equal(readMcpCredential('srv-2', dir)?.accessToken, 'b');
  });

  it('没授权过就是没有', () => {
    assert.equal(readMcpCredential('nope', dir), null);
    assert.equal(hasMcpCredential('nope', dir), false);
  });

  it('清掉一个不影响别的', () => {
    writeMcpCredential('srv-1', cred('a'), dir);
    writeMcpCredential('srv-2', cred('b'), dir);
    clearMcpCredential('srv-1', dir);
    assert.equal(readMcpCredential('srv-1', dir), null);
    assert.equal(readMcpCredential('srv-2', dir)?.accessToken, 'b');
  });

  it('文件坏了当作没有,不让应用起不来', () => {
    fs.writeFileSync(path.join(dir, 'mcp-credentials.json'), 'garbage');
    assert.equal(readMcpCredential('srv-1', dir), null);
  });

  it('**第二次写之后权限仍是 0600** —— writeFileSync 不改已存在文件的 mode', () => {
    writeMcpCredential('srv-1', cred('a'), dir);
    fs.chmodSync(path.join(dir, 'mcp-credentials.json'), 0o644);
    writeMcpCredential('srv-2', cred('b'), dir);
    assert.equal(fs.statSync(path.join(dir, 'mcp-credentials.json')).mode & 0o777, 0o600);
  });
});
