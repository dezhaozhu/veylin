/**
 * **拖进对话框的 Office 文件要能读** —— 和放进项目文件夹是同一件事。
 *
 * 从前这条是硬墙:同一份 xlsx,走文件夹能读概览,拖进来只回一句"转成 PDF 再来"。
 * 用户没有办法理解这两条路为什么不一样 —— 因为这个区别根本不该存在。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import JSZip from 'jszip';

import { officeAttachmentToParts } from './chat.js';

const dataUrl = (bytes: Buffer, mime: string) =>
  `data:${mime};base64,${bytes.toString('base64')}`;

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

describe('Office 附件', () => {
  it('pptx 抽出正文,带文件名和页码', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml',
      '<p:sld xmlns:a="a"><a:p><a:r><a:t>八月底交付</a:t></a:r></a:p></p:sld>');
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;

    const parts = await officeAttachmentToParts(dataUrl(buf, PPTX), '汇报.pptx');
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('\n');
    assert.match(text, /汇报\.pptx/);
    assert.match(text, /第 1 页/);
    assert.match(text, /八月底交付/);
  });

  it('**表格只给概览,并说清怎么才能真分析** —— 不能让模型以为拿到了全部', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(
      Array.from({ length: 300 }, (_, i) => ({ 订单: `D${i}`, 数量: i })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '明细');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const text = (await officeAttachmentToParts(dataUrl(buf, 'application/x-x'), '订单.xlsx'))
      .map((p) => ('text' in p ? p.text : '')).join('\n');
    assert.match(text, /300/);              // 说出总行数
    assert.match(text, /table_query/);      // 说出真分析的路
    assert.ok(!text.includes('D299'), '把全表吐给模型了');
  });

  it('坏文件不崩,回一句读不了', async () => {
    const parts = await officeAttachmentToParts(dataUrl(Buffer.from('xx'), PPTX), '坏.pptx');
    assert.match(parts.map((p) => ('text' in p ? p.text : '')).join(''), /读不了|无法/);
  });

  it('data URL 解不开时不假装读到了内容', async () => {
    const parts = await officeAttachmentToParts('http://example/x.pptx', 'x.pptx');
    assert.match(parts.map((p) => ('text' in p ? p.text : '')).join(''), /读不了|无法/);
  });
});

describe('老二进制格式', () => {
  it('**拒得要能照做** —— "转成 PDF" 对一份 .doc 是没用的建议', async () => {
    const text = (await officeAttachmentToParts(dataUrl(Buffer.from('x'), 'application/msword'), '纪要.doc'))
      .map((p) => ('text' in p ? p.text : '')).join('');
    assert.match(text, /另存为 \.docx/);
  });
});
