/**
 * Office 文件抽文字 —— **一处实现,两个入口**(项目文件夹里的、拖进对话框的)。
 *
 * 这里钉的都是"看起来能用、其实错了"的那类:页序按数字不按字典序、页码要留、
 * 表格不许全量吐、读不了要说得出替代路径。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import JSZip from 'jszip';

import { extractDocument, planExtract } from './document-extract.js';

/** 造一份最小的 pptx:每页一个标题文本框。 */
async function makePptx(slides: string[][], notes: Record<number, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((runs, i) => {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>` +
        runs.map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`).join('') +
        `</p:spTree></p:cSld></p:sld>`,
    );
  });
  for (const [n, text] of Object.entries(notes)) {
    zip.file(
      `ppt/notesSlides/notesSlide${n}.xml`,
      `<?xml version="1.0"?><p:notes xmlns:a="a"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:notes>`,
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

describe('认得哪些', () => {
  it('三件套各归各类', () => {
    assert.equal(planExtract('a.docx').kind, 'doc');
    assert.equal(planExtract('a.xlsx').kind, 'sheet');
    assert.equal(planExtract('a.pptx').kind, 'slides');
  });

  it('**读不了的要说得出替代路径** —— 只说"不支持"等于把人堵死', () => {
    const p = planExtract('a.doc');
    assert.equal(p.kind, 'unsupported');
    assert.match(p.note ?? '', /另存|docx|转/);
  });
});

describe('pptx', () => {
  it('抽出每页的文字,并**带页码**', async () => {
    const buf = await makePptx([['一季度回顾'], ['交付承诺', '8月底']]);
    const out = await extractDocument('汇报.pptx', buf);
    assert.equal(out.kind, 'slides');
    assert.match(out.text ?? '', /第 1 页/);
    assert.match(out.text ?? '', /交付承诺/);
    assert.match(out.text ?? '', /8月底/);
  });

  it('**页序按数字排,不按字典序** —— 否则第 10 页会排到第 2 页前面', async () => {
    const buf = await makePptx(Array.from({ length: 11 }, (_, i) => [`P${i + 1}`]));
    const text = (await extractDocument('x.pptx', buf)).text ?? '';
    assert.ok(text.indexOf('P2') < text.indexOf('P10'), '第 10 页排到了第 2 页前面');
  });

  it('讲者备注要带上,并标明是备注 —— 承诺常写在备注里', async () => {
    const buf = await makePptx([['封面'], ['计划']], { 2: '内部口径:实际能给到9月' });
    const text = (await extractDocument('x.pptx', buf)).text ?? '';
    assert.match(text, /备注/);
    assert.match(text, /实际能给到9月/);
  });

  it('一页字都没有也照样出这一页 —— 缺页比空页更让人以为漏了', async () => {
    const buf = await makePptx([['封面'], []]);
    assert.match((await extractDocument('x.pptx', buf)).text ?? '', /第 2 页/);
  });

  it('不是 zip 的 .pptx 不崩,回一句读不了', async () => {
    const out = await extractDocument('坏.pptx', Buffer.from('not a zip'));
    assert.equal(out.kind, 'unsupported');
    assert.ok(out.notice);
  });
});

describe('表格的人读版概览', () => {
  it('**给一段人能直接读的 overview** —— 只回结构化字段,预览面板就只能显示"没有可预览的内容"', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([{ 订单: 'D1', 数量: 3 }, { 订单: 'D2', 数量: 5 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '明细');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const out = await extractDocument('订单.xlsx', buf);
    assert.equal(out.kind, 'sheet');
    assert.ok(out.overview, '没有给 overview');
    assert.match(out.overview!, /明细/);   // 页签
    assert.match(out.overview!, /订单/);   // 列
    assert.match(out.overview!, /D1/);     // 前几行
    assert.match(out.overview!, /共 2 行/);
  });
});

describe('pdf', () => {
  /** 手写一份最小 PDF(一页,一行文字)—— 不引新依赖就能有真样本。 */
  function makePdf(text: string): Buffer {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R ' +
        '/Resources << /Font << /F1 5 0 R >> >> >>',
      null,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n`;
      pdf += body ?? `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\n`;
      pdf += `${body ? '\n' : ''}endobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }

  it('抽出文字层', async () => {
    const out = await extractDocument('说明.pdf', makePdf('DELIVERY BY AUGUST'));
    assert.equal(out.kind, 'doc');
    assert.match(out.text ?? '', /DELIVERY BY AUGUST/);
  });

  it('**扫描件(没有文字层)要说是扫描件** —— 回一段空白等于说"这份文件是空的"', async () => {
    const out = await extractDocument('扫描.pdf', makePdf(' '));
    assert.match((out.text ?? '') + (out.notice ?? ''), /扫描|没有可提取的文字/);
  });
});
