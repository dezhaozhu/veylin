import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { badgeOf, folderLabel, humanBytes, toContextCards } from './context-cards';

const data = {
  folder: '/Users/me/Documents/vvv',
  originals: [{ name: '开发组件.xlsx', bytes: 16_000, seenCount: 2 }],
  snapshots: [],
  files: [
    { name: '汇报.pptx', bytes: 452, where: 'folder' as const },
    { name: '技术交流.docx', bytes: 1200, where: 'folder' as const },
    { name: '生成/中文稿.docx', bytes: 11_000, where: 'generated' as const },
  ],
};

describe('toContextCards', () => {
  it('**文件夹合成一张卡,写清有几项**', () => {
    const folder = toContextCards(data).find((c) => c.kind === 'folder');
    assert.deepEqual(folder, { kind: 'folder', key: 'folder', name: 'vvv', count: 2 });
  });

  it('**文件夹里的文件不再各占一张卡** —— 否则真正留了档的东西会被淹掉', () => {
    const names = toContextCards(data).map((c) => c.name);
    assert.ok(!names.includes('汇报.pptx'), `文件夹里的文件又单独出现了:${names.join(',')}`);
  });

  it('原件/生成的各是一张卡,来处写在名字下面', () => {
    const cards = toContextCards(data).filter((c) => c.kind === 'file');
    assert.deepEqual(cards.map((c) => c.name), ['开发组件.xlsx', '生成/中文稿.docx']);
    assert.match(cards[0]!.meta, /原件 · 16 KB · 用过 2 次/);
    assert.match(cards[1]!.meta, /生成的 · 11 KB/);
  });

  it('**没绑文件夹就没有那张卡**,不摆一个空壳', () => {
    const cards = toContextCards({ ...data, folder: null });
    assert.equal(cards.some((c) => c.kind === 'folder'), false);
  });

  it('**只有 PDF 出封面** —— 别的类型强行截图既慢又难认', () => {
    const cards = toContextCards({
      folder: null, originals: [], snapshots: [],
      files: [
        { name: '标书.pdf', bytes: 1, where: 'generated' },
        { name: '表.xlsx', bytes: 1, where: 'generated' },
      ],
    });
    assert.deepEqual(cards.map((c) => c.kind === 'file' && c.cover), [true, false]);
  });

  it('类型角标取扩展名;没有扩展名就不给角标', () => {
    assert.equal(badgeOf('a.PDF'), 'PDF');
    assert.equal(badgeOf('README'), null);
  });

  it('文件夹卡只留路径最后一段', () => {
    assert.equal(folderLabel('/Users/me/Documents/vvv'), 'vvv');
  });

  it('大小说人话', () => {
    assert.deepEqual([humanBytes(452), humanBytes(16_000), humanBytes(3_000_000)],
      ['452 B', '16 KB', '2.9 MB']);
  });
});
