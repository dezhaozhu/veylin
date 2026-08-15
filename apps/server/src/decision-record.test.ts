/**
 * 当过依据的东西自动留档(spec 2026-08-14 §5.1 第三档)。
 *
 * 三档里前两档靠人:人明确要的落文件、答问的副产品留在对话里可另存。**第三档不靠
 * 人记得** —— 一个中间产物一旦**被后续动作依赖**(你看着那份预览按了提交),它就
 * 不再是中间产物,而是**这个决定的依据**,将来要能翻账。
 *
 * 于是"该不该留"由事实决定,不由用户记不记得点保存。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDecisionRecord, decisionFileName } from './decision-record.js';

let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'veylin-dec-')); });
afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

const at = new Date('2026-08-15T09:30:00');

describe('decisionFileName', () => {
  it('按事件命名 + 时间,不用时间戳数字', () => {
    assert.equal(decisionFileName('排产变更', at), '排产变更 2026-08-15 09-30.md');
  });
});

describe('writeDecisionRecord', () => {
  it('落进 证据/ 下,只读', async () => {
    const out = await writeDecisionRecord({
      folder, title: '排产变更', at,
      summary: '提交 3 条改动',
      facts: { 提交条数: 3, 延后条数: 0, run_id: 'run-42', 结果: 'feasible' },
    });
    assert.ok(out.path?.includes(join(folder, '证据')), out.path ?? '(没写成)');
    assert.equal(statSync(out.path!).mode & 0o222, 0, '依据必须只读 —— 事后改它就是改历史');
  });

  it('内容说清楚三件事:什么时候、做了什么、凭什么', async () => {
    const out = await writeDecisionRecord({
      folder, title: '排产变更', at,
      summary: '提交 3 条改动',
      facts: { 提交条数: 3, run_id: 'run-42' },
      evidence: '影子对比:迟到 4,077 → 4,051;违规 0 → 0',
    });
    const text = readFileSync(out.path!, 'utf8');
    assert.match(text, /2026-08-15/);
    assert.match(text, /提交 3 条改动/);
    assert.match(text, /run-42/);
    assert.match(text, /影子对比/);
  });

  it('同一分钟内再来一次不覆盖 —— 依据被改写就不是依据了', async () => {
    const a = await writeDecisionRecord({ folder, title: '排产变更', at, summary: 'x', facts: {} });
    const b = await writeDecisionRecord({ folder, title: '排产变更', at, summary: 'y', facts: {} });
    assert.notEqual(a.path, b.path);
    assert.equal(readdirSync(join(folder, '证据')).length, 2);
  });

  it('没有文件夹:不抛异常,回报原因 —— 提交已经发生了,不能因为留档失败就报错', async () => {
    const out = await writeDecisionRecord({
      folder: undefined, title: '排产变更', at, summary: 'x', facts: {},
    });
    assert.equal(out.written, false);
    assert.match(out.reason ?? '', /没有绑定文件夹/);
  });

  it('文件夹被移走:同样照实说', async () => {
    rmSync(folder, { recursive: true, force: true });
    const out = await writeDecisionRecord({ folder, title: '排产变更', at, summary: 'x', facts: {} });
    assert.equal(out.written, false);
    assert.match(out.reason ?? '', /不存在/);
  });
});
