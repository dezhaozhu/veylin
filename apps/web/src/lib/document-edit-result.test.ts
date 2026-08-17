/**
 * 文档修改的结果长什么样。
 *
 * **改已经发生了** —— 按用户定的治理模型(版本+回退当安全网,而不是每一步都设闸),
 * 界面要做的不是"要不要改",是**让人一眼看见改了什么、并且一键能退回去**。
 * 所以措辞必须说清三件事:改了、原件没动、能撤销。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffLines, undoTarget, describeEdit } from './document-edit-result.js';

describe('diffLines', () => {
  it('分出增删', () => {
    const out = diffLines('- 粗加工由金工分厂做\n+ 粗加工由锻件分厂做');
    assert.deepEqual(out.map((l) => l.kind), ['del', 'add']);
    assert.equal(out[0]!.text, '粗加工由金工分厂做');
  });

  it('**没有前缀的行当上下文,不当新增** —— 标错颜色比不标更误导', () => {
    assert.equal(diffLines('  上下文一行')[0]!.kind, 'ctx');
  });

  it('空 diff 给空数组,不炸', () => {
    assert.deepEqual(diffLines(''), []);
    assert.deepEqual(diffLines(undefined as never), []);
  });
});

describe('undoTarget —— 撤销退到哪一版', () => {
  it('第 3 版的撤销 = 回到第 2 版', () => {
    assert.equal(undoTarget(3), 2);
  });

  it('**第 1 版没得退** —— 它是副本刚建立的那一版,退回去等于什么都没有', () => {
    assert.equal(undoTarget(1), null);
    assert.equal(undoTarget(0), null);
  });
});

describe('describeEdit —— 一句话说清发生了什么', () => {
  it('说清三件事:改了第几版、原件没动、能撤销', () => {
    const s = describeEdit({ copy: '文稿/工艺说明.md', revision: 2 });
    assert.match(s, /第 2 版/);
    assert.match(s, /原件/);
  });

  it('**第一次改要说副本是新建的** —— 不说,人会以为我们动了他那份 docx', () => {
    const s = describeEdit({ copy: '文稿/x.md', revision: 1, created: true });
    assert.match(s, /新建|建了/);
  });
});
