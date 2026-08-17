/**
 * 文件夹里冒出来的新文件:**只列,不自动吸收**(spec 2026-08-14 §6)。
 *
 * 顺手往文件夹里放一份 ≠ 它就是项目数据。自动解析会让"这东西什么时候进来的、
 * 谁放的"变成无人知晓 —— 与"导入即留档"要的正好相反。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KNOWN_EXTENSIONS, scanProjectInbox } from './project-inbox.js';
import { storeOriginal } from './project-originals.js';

let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'veylin-inbox-')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

const put = (name: string, body = 'x') => writeFileSync(join(folder, name), body);

describe('scanProjectInbox', () => {
  it('列出还没导入过的文件', async () => {
    put('三级计划.xlsx');
    put('说明.docx');
    const out = await scanProjectInbox(folder);
    assert.deepEqual(out.pending.map((f) => f.name).sort(), ['三级计划.xlsx', '说明.docx']);
  });

  it('已经留档过的同一份内容不再提示 —— 认哈希,不认文件名', async () => {
    await storeOriginal(folder, '三级计划.xlsx', Buffer.from('same'));
    put('三级计划.xlsx', 'same');
    put('改了名字也是同一份.xlsx', 'same');
    const out = await scanProjectInbox(folder);
    assert.deepEqual(out.pending, [], '内容一样就是同一份东西,换个名字不算新的');
  });

  it('同名但内容变了 → 是新版本,要提示', async () => {
    await storeOriginal(folder, 'x.xlsx', Buffer.from('v1'));
    put('x.xlsx', 'v2');
    const out = await scanProjectInbox(folder);
    assert.deepEqual(out.pending.map((f) => f.name), ['x.xlsx']);
  });

  it('不碰 .veylin、快照/、以及子目录 —— 只看顶层', async () => {
    mkdirSync(join(folder, '子目录'));
    writeFileSync(join(folder, '子目录', '深处.xlsx'), 'deep');
    mkdirSync(join(folder, '快照'), { recursive: true });
    writeFileSync(join(folder, '快照', '工序 快照 2026-08-14 15-20.xlsx'), 'snap');
    await storeOriginal(folder, 'a.xlsx', Buffer.from('a'));   // 造出 .veylin
    const out = await scanProjectInbox(folder);
    assert.deepEqual(out.pending, []);
  });

  it('只看认得的后缀,忽略 .DS_Store 之类', async () => {
    put('.DS_Store');
    put('笔记.txt');
    put('表.xlsx');
    const out = await scanProjectInbox(folder);
    assert.deepEqual(out.pending.map((f) => f.name), ['表.xlsx']);
  });

  it('文件夹不在:返回空 + 说清楚,而不是抛出来', async () => {
    rmSync(folder, { recursive: true, force: true });
    const out = await scanProjectInbox(folder);
    assert.deepEqual(out.pending, []);
    assert.match(out.note ?? '', /不存在/);
  });
});

describe('认得的后缀 = 真读得了的后缀', () => {
  it('**收件箱不能提示一个我们读不了的文件** —— 提示了就是让人白点一次', async () => {
    const { planExtract } = await import('./document-extract.js');
    for (const ext of KNOWN_EXTENSIONS) {
      const plan = planExtract(`x${ext}`);
      assert.notEqual(plan.kind, 'unsupported', `收件箱认得 ${ext},但抽取器读不了`);
    }
  });
});
