/**
 * 点开一个拖进来的文件。**失败要说出原因** —— 一个转圈转到空白的预览,
 * 比一句"这类文件看不了"更让人不知道该干嘛。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previewAttachment } from './attachment-preview.js';

const res = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('previewAttachment', () => {
  it('文档类回正文', async () => {
    const out = await previewAttachment('a.pptx', 'data:x;base64,eA==', res({ ok: true, kind: 'slides', text: '第 1 页' }));
    assert.equal(out.state, 'text');
    if (out.state === 'text') assert.match(out.body, /第 1 页/);
  });

  it('**表格用 overview** —— 表格没有 text,拿不到就会显示成"没有可预览的内容"', async () => {
    const out = await previewAttachment('a.xlsx', 'data:x;base64,eA==',
      res({ ok: true, kind: 'sheet', overview: '页签:明细', note: '这是概览' }));
    assert.equal(out.state, 'text');
    if (out.state === 'text') {
      assert.match(out.body, /页签/);
      assert.equal(out.note, '这是概览');
    }
  });

  it('看不了就把服务端的原话给出来', async () => {
    const out = await previewAttachment('a.doc', 'data:x;base64,eA==',
      res({ ok: true, kind: 'unsupported', note: '.doc 是老的二进制格式,读不了。用 Office 另存为 .docx 再来。' }));
    assert.equal(out.state, 'note');
    if (out.state === 'note') assert.match(out.body, /另存为 \.docx/);
  });

  it('HTTP 出错也要有话说,不能停在转圈上', async () => {
    const out = await previewAttachment('a.pptx', 'data:x;base64,eA==', res({ error: '缺少 name 或 data' }, 400));
    assert.equal(out.state, 'note');
    if (out.state === 'note') assert.match(out.body, /缺少/);
  });

  it('拿不到文件字节时不发请求 —— 直说', async () => {
    let called = false;
    const out = await previewAttachment('a.pptx', undefined, (async () => {
      called = true; return new Response('{}');
    }) as unknown as typeof fetch);
    assert.equal(out.state, 'note');
    assert.equal(called, false);
  });
});
