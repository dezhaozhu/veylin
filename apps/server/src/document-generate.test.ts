/**
 * 生成 Word / PPT。**输入是 markdown** —— 模型本来就写 markdown,再发明一套结构
 * 只会让它填错格子。
 *
 * 这里钉的是"生成出来的东西真能打开、内容真在里面"。造出一份 Word 但 Word 打不开,
 * 或者表格悄悄丢了,都是"看起来成了"的失败。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import JSZip from 'jszip';

import { generateDocx, generatePptx, splitSlides } from './document-generate.js';

/** 生成物是 zip;把里面的 XML 读出来才算验到内容,不然只验了"有字节"。 */
async function xmlOf(bytes: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.files[path];
  assert.ok(f, `包里没有 ${path}`);
  return f.async('string');
}

const MD = [
  '# 上重 8 月进度',
  '',
  '未排 0,中位延误 239 天。',
  '',
  '## 瓶颈',
  '',
  '- 120MN 水压机',
  '- 金工分厂',
  '',
  '| 分厂 | 负载 |',
  '| --- | --- |',
  '| 锻件 | 164% |',
].join('\n');

describe('generateDocx', () => {
  it('生成的是**真能打开的 docx**(OOXML 包结构齐)', async () => {
    const buf = await generateDocx('进度', MD);
    const zip = await JSZip.loadAsync(buf);
    assert.ok(zip.files['word/document.xml'], '缺 word/document.xml');
    assert.ok(zip.files['[Content_Types].xml'], '缺 [Content_Types].xml');
  });

  it('标题、正文、列表都在', async () => {
    const xml = await xmlOf(await generateDocx('进度', MD), 'word/document.xml');
    assert.match(xml, /上重 8 月进度/);
    assert.match(xml, /中位延误 239 天/);
    assert.match(xml, /120MN 水压机/);
  });

  it('**表格要真成表格** —— 拍平成一行文字,行列关系就没了', async () => {
    const xml = await xmlOf(await generateDocx('进度', MD), 'word/document.xml');
    assert.match(xml, /<w:tbl>/, '表格没生成成 Word 表格');
    assert.match(xml, /164%/);
  });

  it('空内容也给一份能打开的文件,不抛 —— 但要留下一句说明', async () => {
    const xml = await xmlOf(await generateDocx('空的', ''), 'word/document.xml');
    assert.match(xml, /空的/);
  });
});

describe('splitSlides —— markdown 怎么切成幻灯片', () => {
  it('**按二级标题切**,一节一页 —— 这是人写汇报时本来的结构', () => {
    const s = splitSlides('# 总题\n\n开场\n\n## 一\n\n甲\n\n## 二\n\n乙');
    assert.equal(s.length, 3);
    assert.equal(s[0]!.title, '总题');
    assert.equal(s[1]!.title, '一');
  });

  it('`---` 也切 —— 写汇报的人习惯用它分页', () => {
    assert.equal(splitSlides('## 一\n\n甲\n\n---\n\n乙').length, 2);
  });

  it('一个标题都没有就是一页,不是零页', () => {
    const s = splitSlides('就一段话');
    assert.equal(s.length, 1);
    assert.match(s[0]!.body, /就一段话/);
  });
});

describe('generatePptx', () => {
  it('生成的是真能打开的 pptx,页数=切出来的页数', async () => {
    const md = '# 封面\n\n## 一\n\n甲\n\n## 二\n\n乙';
    const zip = await JSZip.loadAsync(await generatePptx('汇报', md));
    const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    assert.equal(slides.length, splitSlides(md).length);
  });

  it('**生成的 pptx 要能被我们自己的抽取器读回来** —— 读写对不上就是各说各话', async () => {
    const { extractDocument } = await import('./document-extract.js');
    const out = await extractDocument('x.pptx', await generatePptx('汇报', '## 瓶颈\n\n120MN 水压机'));
    assert.equal(out.kind, 'slides');
    assert.match(out.text ?? '', /120MN 水压机/);
  });
});

describe('落到哪儿', () => {
  it('**进 `生成/`,不进项目根** —— 放根目录会被收件箱当成"有新文件待导入",我们自己生成的东西转头请人再导一遍', async () => {
    const { generatedDir } = await import('./document-generate.js');
    assert.equal(generatedDir('/p'), '/p/生成');
  });

  it('文件名带生成时间 —— 半年后打开还知道这是哪一版', async () => {
    const { generatedFileName } = await import('./document-generate.js');
    const n = generatedFileName('上重进度', 'docx', new Date('2026-08-16T15:20:00'));
    assert.match(n, /上重进度/);
    assert.match(n, /2026-08-16 15-20/);
    assert.ok(n.endsWith('.docx'));
  });

  it('**同一分钟再生成不覆盖前一份**', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { saveGenerated } = await import('./document-generate.js');
    const dir = mkdtempSync(join(tmpdir(), 'gen-'));
    try {
      const at = new Date('2026-08-16T15:20:00');
      const a = await saveGenerated(dir, '报告', 'docx', Buffer.from('A'), at);
      const b = await saveGenerated(dir, '报告', 'docx', Buffer.from('B'), at);
      assert.notEqual(a.path, b.path, '第二份把第一份盖掉了');
      const { readFileSync } = await import('node:fs');
      assert.equal(readFileSync(a.path, 'utf8'), 'A');
      void writeFileSync;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('生成的文件是只读的 —— 和快照同一条规矩', async () => {
    const { mkdtempSync, rmSync, statSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { saveGenerated } = await import('./document-generate.js');
    const dir = mkdtempSync(join(tmpdir(), 'gen-'));
    try {
      const out = await saveGenerated(dir, '报告', 'docx', Buffer.from('A'), new Date());
      assert.equal(statSync(out.path).mode & 0o222, 0, '生成的文件可写');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('实测抓到的坑', () => {
  it('**正文本来就有一级标题时,不要再插一个** —— 生成出来标题连着重复两遍', async () => {
    const zip = await JSZip.loadAsync(await generateDocx('上重 8 月进度', '# 上重 8 月进度\n\n正文'));
    const xml = await zip.files['word/document.xml']!.async('string');
    const hits = xml.match(/上重 8 月进度/g) ?? [];
    assert.equal(hits.length, 1, `标题出现了 ${hits.length} 次`);
  });

  it('标题不一样时两个都留 —— 那是两件事', async () => {
    const zip = await JSZip.loadAsync(await generateDocx('封面标题', '# 正文标题\n\n内容'));
    const xml = await zip.files['word/document.xml']!.async('string');
    assert.match(xml, /封面标题/);
    assert.match(xml, /正文标题/);
  });
});
