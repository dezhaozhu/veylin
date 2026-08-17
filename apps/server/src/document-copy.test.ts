/**
 * 可编辑副本 —— 原件不动,改发生在副本上。
 *
 * 为什么不原地改 docx:Word 会把一句话拆进好几个 `<w:r>`(拼写检查、局部格式都会
 * 切),选中的那段在文件里很可能不是连续存着的。保格式改 docx 是一整块最容易
 * 出错的代码。副本这条路把它整块绕开 —— 参考实现(Claude)也是这么做的。
 *
 * 这里钉的是"改得准、改不动时说得清、上一版查得到"。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyAnchoredEdit, htmlToMarkdown } from './document-copy.js';

describe('原件 → markdown', () => {
  it('标题、列表、加粗都在', () => {
    const md = htmlToMarkdown('<h1>标题</h1><p>正文 <strong>粗</strong></p><ul><li>甲</li></ul>');
    assert.match(md, /^# 标题/m);
    assert.match(md, /\*\*粗\*\*/);
    assert.match(md, /^-\s+甲/m);
  });

  it('**表格必须活下来** —— turndown 默认会把它拍成几段孤立文字,行列关系就没了', () => {
    const md = htmlToMarkdown(
      '<table><tr><td><p>分厂</p></td><td><p>负载</p></td></tr>' +
      '<tr><td><p>锻件</p></td><td><p>164%</p></td></tr></table>',
    );
    assert.match(md, /\|\s*分厂\s*\|\s*负载\s*\|/);
    assert.match(md, /\|\s*---/);
    assert.match(md, /\|\s*锻件\s*\|\s*164%\s*\|/);
  });

  it('单元格里的竖线要转义,否则会把表格结构撑破', () => {
    const md = htmlToMarkdown('<table><tr><td>a|b</td><td>c</td></tr></table>');
    assert.match(md, /a\\\|b/);
  });
});

describe('applyAnchoredEdit —— 按原文锚点改', () => {
  const doc = '## 一\n\n粗加工由金工分厂做。\n\n## 二\n\n粗加工由金工分厂做。\n';

  it('唯一命中就改', () => {
    const out = applyAnchoredEdit('粗加工由金工分厂做。', '粗加工由金工分厂做', '粗加工由锻件分厂做');
    assert.equal(out.ok, true);
    if (out.ok) assert.match(out.text, /锻件分厂/);
  });

  it('**找不到就拒,不做模糊匹配** —— 猜着改会改到别处,而且看不出来', () => {
    const out = applyAnchoredEdit(doc, '粗加工由冶铸分厂做', 'x');
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /找不到/);
  });

  it('**出现多处就拒,并说出有几处** —— 只改第一处是悄悄改错', () => {
    const out = applyAnchoredEdit(doc, '粗加工由金工分厂做', 'x');
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.match(out.reason, /2 处/);
      assert.match(out.reason, /写长|更长/);   // 给出可照做的下一步
    }
  });

  it('改成一样的内容 = 什么也没改,要说出来而不是记一个空版本', () => {
    const out = applyAnchoredEdit('甲乙丙', '乙', '乙');
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.reason, /没有变化/);
  });

  it('回一段 diff 给人看 —— 让人否决,而不是让人自己去比对', () => {
    const out = applyAnchoredEdit('粗加工由金工分厂做', '金工分厂', '锻件分厂');
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.match(out.diff, /-.*金工分厂/);
      assert.match(out.diff, /\+.*锻件分厂/);
    }
  });
});

// —— 落盘、版本、回退 ————————————————————————————

import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = () => mkdtempSync(join(tmpdir(), 'copy-'));

describe('副本与版本', () => {
  it('**原件一个字节不动** —— 副本另存,两者之间只有一根 provenance 指针', async () => {
    const { openCopy } = await import('./document-copy.js');
    const dir = tmp();
    try {
      writeFileSync(join(dir, '工艺.md'), '# 工艺\n\n粗加工由金工分厂做。\n');
      const before = readFileSync(join(dir, '工艺.md'), 'utf8');
      const copy = await openCopy(dir, '工艺.md');
      assert.equal(readFileSync(join(dir, '工艺.md'), 'utf8'), before, '原件被改了');
      assert.match(copy.path, /文稿/);
      assert.ok(copy.fromHash, '没记来源哈希');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('已经有副本就用已有的,不覆盖人改过的内容', async () => {
    const { openCopy, saveRevision } = await import('./document-copy.js');
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.md'), '原文');
      const c1 = await openCopy(dir, 'a.md');
      await saveRevision(dir, 'a.md', '改过的内容', '手动改');
      const c2 = await openCopy(dir, 'a.md');
      assert.equal(c2.text, '改过的内容', '第二次打开把人改的内容盖回去了');
      assert.equal(c1.path, c2.path);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('**每存一次是一版,只增不删**', async () => {
    const { openCopy, saveRevision, listRevisions } = await import('./document-copy.js');
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.md'), 'v0');
      await openCopy(dir, 'a.md');
      await saveRevision(dir, 'a.md', 'v1', '第一次改');
      await saveRevision(dir, 'a.md', 'v2', '第二次改');
      const revs = await listRevisions(dir, 'a.md');
      assert.equal(revs.length, 3);           // 初版 + 两次改
      assert.equal(revs.at(-1)!.note, '第二次改');
      assert.ok(revs.every((r, i) => r.n === i + 1), '版本号不连续');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('**回退是追加一版,不是抹掉中间那几版** —— 工业场景里"什么时候变的"要能查', async () => {
    const { openCopy, saveRevision, listRevisions, rollbackTo, readCopy } = await import('./document-copy.js');
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.md'), 'v0');
      await openCopy(dir, 'a.md');
      await saveRevision(dir, 'a.md', 'v1', '改');
      await rollbackTo(dir, 'a.md', 1);
      assert.equal(await readCopy(dir, 'a.md'), 'v0');
      const revs = await listRevisions(dir, 'a.md');
      assert.equal(revs.length, 3, '回退把历史抹掉了');
      assert.match(revs.at(-1)!.note, /回退到第 1 版/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('回退到不存在的版本要拒绝,不能悄悄退到最近的一版', async () => {
    const { openCopy, rollbackTo } = await import('./document-copy.js');
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.md'), 'v0');
      await openCopy(dir, 'a.md');
      await assert.rejects(() => rollbackTo(dir, 'a.md', 99), /没有第 99 版/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('副本本身是可写的 —— 它就是拿来改的(和原件、快照、生成物都不同)', async () => {
    const { openCopy } = await import('./document-copy.js');
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'a.md'), 'v0');
      const c = await openCopy(dir, 'a.md');
      assert.notEqual(statSync(c.path).mode & 0o200, 0, '副本是只读的,那就没法改了');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('逃出项目文件夹的名字一律拒绝', async () => {
    const { openCopy } = await import('./document-copy.js');
    const dir = tmp();
    try {
      await assert.rejects(() => openCopy(dir, '../../etc/passwd'), /项目文件夹/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('合并单元格', () => {
  const html =
    '<table>' +
    '<tr><td>板块</td><td>分类</td></tr>' +
    '<tr><td rowspan="2">核电</td><td>容器类</td></tr>' +
    '<tr><td>堆内构件</td></tr>' +
    '</table>';

  it('**rowspan 的格子要在下一行补上** —— 不补,下一行整体左移,"堆内构件"就跑到了板块列', () => {
    const rows = htmlToMarkdown(html).split('\n').filter((l) => l.startsWith('|'));
    const last = rows.at(-1)!;
    assert.match(last, /\|\s*核电\s*\|\s*堆内构件\s*\|/, `最后一行错位了:${last}`);
  });

  it('colspan 的格子占满它该占的列数', () => {
    const rows = htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr><tr><td colspan="2">合并</td></tr></table>')
      .split('\n').filter((l) => l.startsWith('|'));
    // 表头 2 列,合并那行也要是 2 列 —— 少一列会让整张表的列数对不齐
    assert.equal((rows.at(-1)!.match(/\|/g) ?? []).length, 3);
  });
});
