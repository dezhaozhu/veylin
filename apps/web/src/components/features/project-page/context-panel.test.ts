/**
 * 上下文摊平成清单 —— 顺序和措辞都是判断,不是格式化。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flattenContext } from './context-panel.js';

const data = {
  originals: [{ name: 'a.xlsx', bytes: 2048, seenCount: 3 }],
  snapshots: [{ name: 'b.csv', bytes: 500, at: '2026-08-01T00:00:00Z' }],
  connectors: [{ server: 'compass', tenant: 'guolu', oldestLoadedAt: new Date().toISOString(), sheets: ['orders'] }],
};

describe('摊平上下文', () => {
  it('**文件在前,连接器在后** —— 文件存下来就不变,连接器会腐烂', () => {
    const out = flattenContext(data);
    assert.equal(out[0]?.kind, 'file');
    assert.equal(out[out.length - 1]?.kind, 'connector');
  });

  it('原件带上"用过几次" —— 同一份表被反复引用,是判断它重不重要的依据', () => {
    assert.match(flattenContext(data)[0]!.detail, /用过 3 次/);
  });

  it('连接器带上新鲜度 —— 它是会腐烂的东西,不说等于让人当成固定的', () => {
    const c = flattenContext(data).find((i) => i.kind === 'connector')!;
    assert.ok(c.detail.length > 0);
    assert.match(c.detail, /orders/);
  });

  it('什么都没有就是空清单,不编条目', () => {
    assert.deepEqual(flattenContext({ originals: [], snapshots: [], connectors: [] }), []);
  });
});

describe('文件夹里的文件也进清单', () => {
  const base = { originals: [], snapshots: [], connectors: [] };

  it('**放进项目文件夹的文件要出现** —— 不出现,"在右侧打开"这个入口就够不着(实测)', () => {
    const items = flattenContext({
      ...base,
      files: [{ name: '工艺说明.docx', bytes: 2048, at: '2026-08-16T10:00:00Z', where: 'folder' }],
    });
    assert.equal(items[0]!.name, '工艺说明.docx');
    assert.match(items[0]!.detail, /文件夹/);
  });

  it('三类分别标清:文件夹里的 / 生成的 / 文稿', () => {
    const items = flattenContext({
      ...base,
      files: [
        { name: '生成/汇报.docx', bytes: 1, at: '2026-08-16T12:00:00Z', where: 'generated' },
        { name: '文稿/工艺说明.md', bytes: 1, at: '2026-08-16T11:00:00Z', where: 'draft' },
      ],
    });
    assert.match(items.find((i) => i.name.includes('汇报'))!.detail, /生成/);
    assert.match(items.find((i) => i.name.includes('工艺说明'))!.detail, /文稿|副本/);
  });

  it('没有 files 字段时不炸 —— 老响应还在路上', () => {
    assert.doesNotThrow(() => flattenContext(base as never));
  });
});
