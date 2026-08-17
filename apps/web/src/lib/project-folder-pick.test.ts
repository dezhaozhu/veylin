/**
 * 选文件夹这一步**不许把界面吊死**。
 *
 * 实测:桌面端点「选择文件夹」之后整个应用卡住 —— 原生面板那个 promise 永远不
 * 落地(权限是全的,`dialog:default` 含 `allow-open`,所以不是被拒)。界面不该把
 * 自己的可用性押在一个可能永不 settle 的调用上。
 *
 * 所以:**永远有一条不依赖原生面板的路**(把路径粘进来),原生面板只是便利,
 * 而且带超时 —— 超时之后明说"没响应,直接粘路径",而不是转圈转到天荒地老。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickWithTimeout, normalizeTypedPath } from './project-folder-pick.js';

const never = () => new Promise<string | null>(() => {});

describe('pickWithTimeout', () => {
  it('正常选中', async () => {
    const out = await pickWithTimeout(async () => '/Users/me/上重', 50);
    assert.deepEqual(out, { status: 'picked', path: '/Users/me/上重' });
  });

  it('用户取消', async () => {
    assert.deepEqual(await pickWithTimeout(async () => null, 50), { status: 'cancelled' });
  });

  it('原生面板不响应 → 超时收场,不吊死', async () => {
    const out = await pickWithTimeout(never, 20);
    assert.equal(out.status, 'timeout');
  });

  it('原生面板报错 → 也当作不可用,不抛给界面', async () => {
    const out = await pickWithTimeout(async () => { throw new Error('boom'); }, 50);
    assert.equal(out.status, 'unavailable');
  });
});

describe('normalizeTypedPath —— 手动粘路径这条路必须好使', () => {
  it('去掉首尾空白与换行(从访达复制常带)', () => {
    assert.equal(normalizeTypedPath('  /Users/me/上重\n '), '/Users/me/上重');
  });

  it('去掉包裹的引号(终端里拖文件会带)', () => {
    assert.equal(normalizeTypedPath('"/Users/me/上 重"'), '/Users/me/上 重');
    assert.equal(normalizeTypedPath("'/Users/me/x'"), '/Users/me/x');
  });

  it('file:// 开头的也认(从某些应用复制会带)', () => {
    assert.equal(normalizeTypedPath('file:///Users/me/上重'), '/Users/me/上重');
  });

  it('转义的空格还原', () => {
    assert.equal(normalizeTypedPath('/Users/me/上\\ 重'), '/Users/me/上 重');
  });

  it('末尾多余的斜杠去掉(除了根)', () => {
    assert.equal(normalizeTypedPath('/Users/me/上重/'), '/Users/me/上重');
    assert.equal(normalizeTypedPath('/'), '/');
  });

  it('空的就是空的', () => {
    assert.equal(normalizeTypedPath('   '), '');
  });
});
