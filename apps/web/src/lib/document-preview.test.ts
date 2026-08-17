/**
 * 预览用哪种形态。**"画得出来"优先于"读得出来"** —— 一份有版式的文件被摊成
 * 纯文字是失真的:Word 的表格会变成一行一格,人会以为原文就长这样。
 *
 * 而什么都给不出时,要给的是一张**文件卡 + 下载**,不是"没有可预览的内容" ——
 * 后者听起来像"这个文件是空的"。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previewMode, type PreviewPayload } from './document-preview.js';

describe('previewMode', () => {
  it('有缩略图就先看图 —— 一眼知道这是什么', () => {
    assert.equal(previewMode({ thumbnail: 'data:image/png;base64,x', text: '正文' }), 'image');
  });

  it('有版式的 HTML 胜过纯文字', () => {
    assert.equal(previewMode({ html: '<table></table>', text: '拍平的文字' }), 'html');
  });

  it('只有文字就给文字', () => {
    assert.equal(previewMode({ text: '一段话' }), 'text');
  });

  it('**空白文字不算文字** —— 显示一片空白等于说"这份文件是空的"', () => {
    assert.equal(previewMode({ text: '   \n  ' }), 'none');
  });

  it('什么都没有 → 文件卡', () => {
    assert.equal(previewMode({}), 'none');
    assert.equal(previewMode({ note: '这类文件看不了' }), 'none');
  });

  it('**html 只是一个空壳时不算** —— 空表格框比文字更没用', () => {
    assert.equal(previewMode({ html: '  ', text: '有正文' } as PreviewPayload), 'text');
  });
});

describe('沙箱 srcdoc', () => {
  it('**禁掉脚本和外连** —— 这段 HTML 来自用户的文件,不是我们写的模板', async () => {
    const { sandboxSrcDoc } = await import('./document-preview.js');
    const doc = sandboxSrcDoc('<p>hi</p>');
    assert.match(doc, /Content-Security-Policy/);
    assert.match(doc, /default-src 'none'/);
    assert.match(doc, /img-src data:/);   // Word 里的图是 data URI,要能显示
    assert.ok(!/script-src[^;]*'unsafe/.test(doc), '给脚本开了口子');
    assert.match(doc, /<p>hi<\/p>/);
  });
});
