/**
 * 在访达里显示某个路径(与 Claude 项目里的 Show in Folder 同形)。
 *
 * 服务端替桌面端做这件事(前端没有 opener/shell 插件绑定)。**唯一要紧的是边界**:
 * 只允许显示**项目文件夹之内**的东西 —— 否则这就成了一个"让本机打开任意路径"
 * 的接口。路径比较要防 `..` 逃逸,也要防 `/a/bcd` 冒充 `/a/b` 的前缀陷阱。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInsideFolder, revealCommand } from './project-reveal.js';

describe('isInsideFolder', () => {
  it('文件夹里的文件:允许', () => {
    assert.equal(isInsideFolder('/Users/me/上重', '/Users/me/上重/快照/a.xlsx'), true);
  });

  it('文件夹自己:允许', () => {
    assert.equal(isInsideFolder('/Users/me/上重', '/Users/me/上重'), true);
  });

  it('`..` 逃出去:拒绝', () => {
    assert.equal(isInsideFolder('/Users/me/上重', '/Users/me/上重/../../.ssh/id_rsa'), false);
  });

  it('前缀陷阱:`/Users/me/上重x` 不算在 `/Users/me/上重` 里', () => {
    assert.equal(isInsideFolder('/Users/me/上重', '/Users/me/上重x/秘密.txt'), false);
  });

  it('完全无关的路径:拒绝', () => {
    assert.equal(isInsideFolder('/Users/me/上重', '/etc/passwd'), false);
  });

  it('没有绑文件夹:一律拒绝(不能变成"随便打开")', () => {
    assert.equal(isInsideFolder(undefined, '/Users/me/上重/a.xlsx'), false);
  });
});

describe('revealCommand —— 参数数组,不拼字符串', () => {
  it('macOS 用 open -R', () => {
    const c = revealCommand('darwin', '/Users/me/上重/a.xlsx');
    assert.deepEqual(c, { cmd: 'open', args: ['-R', '/Users/me/上重/a.xlsx'] });
  });

  it('Windows 用 explorer /select,', () => {
    const c = revealCommand('win32', 'C:\\p\\a.xlsx');
    assert.equal(c?.cmd, 'explorer');
    assert.ok(c?.args.some((a) => a.includes('a.xlsx')));
  });

  it('Linux 打开所在目录(xdg-open 没有 select)', () => {
    const c = revealCommand('linux', '/home/me/p/a.xlsx');
    assert.deepEqual(c, { cmd: 'xdg-open', args: ['/home/me/p'] });
  });

  it('认不出的平台:不猜,返回 null', () => {
    assert.equal(revealCommand('aix', '/x/a'), null);
  });

  it('路径永远是**单独一个参数** —— 不拼进命令行,也就没有注入面', () => {
    const c = revealCommand('darwin', '/tmp/a; rm -rf ~');
    assert.deepEqual(c!.args, ['-R', '/tmp/a; rm -rf ~']);
  });
});
