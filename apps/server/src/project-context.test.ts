/**
 * 项目里到底有什么 —— 摆出来给人看(Claude 项目页 Context 那一栏的形状)。
 *
 * 两类东西**分开说**,这是整条线一直在守的那条:
 *  - 文件(原件 / 快照 / 产出):存下来就不变;
 *  - 连接器(Compass):会腐烂,所以必须说**上次刷新是什么时候**。
 *
 * 「上次刷新几分钟前」是我们诚实线上最后一个还没露脸的事实 —— loadedAt 一直在
 * 存,只有代码知道。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listProjectFiles, scanProjectGeometry, summarizeConnectors } from './project-context.js';

const sheet = (name: string, source: unknown) => ({ id: `p_x~${name}`, name, source } as never);

describe('summarizeConnectors', () => {
  it('同一个连接器的多张表合成一条,列出表名', () => {
    const out = summarizeConnectors([
      sheet('工序', { kind: 'connector', server: 'compass', tenant: 'shangzhong', loadedAt: '2026-08-14T07:00:00Z' }),
      sheet('派工', { kind: 'connector', server: 'compass', tenant: 'shangzhong', loadedAt: '2026-08-14T09:00:00Z' }),
    ]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]!.sheets, ['工序', '派工']);
  });

  it('取**最旧**那张的时间 —— 一条连接器的新鲜度取决于最陈旧的那份', () => {
    const out = summarizeConnectors([
      sheet('工序', { kind: 'connector', server: 'compass', tenant: 'sz', loadedAt: '2026-08-14T07:00:00Z' }),
      sheet('派工', { kind: 'connector', server: 'compass', tenant: 'sz', loadedAt: '2026-08-14T09:00:00Z' }),
    ]);
    assert.equal(out[0]!.oldestLoadedAt, '2026-08-14T07:00:00Z');
  });

  it('不同租户是不同的连接器条目', () => {
    const out = summarizeConnectors([
      sheet('a', { kind: 'connector', server: 'compass', tenant: 'guolu', loadedAt: '2026-08-14T07:00:00Z' }),
      sheet('b', { kind: 'connector', server: 'compass', tenant: 'shangzhong', loadedAt: '2026-08-14T07:00:00Z' }),
    ]);
    assert.equal(out.length, 2);
  });

  it('文件来源的表不算连接器 —— 它不会腐烂', () => {
    const out = summarizeConnectors([
      sheet('原表', { kind: 'file', fileHash: 'abc', fileName: 'x.xlsx', importedAt: '2026-08-14T00:00:00Z' }),
    ]);
    assert.deepEqual(out, []);
  });

  it('没有来源戳的表(自己建的)也不算', () => {
    assert.deepEqual(summarizeConnectors([sheet('随手建的', undefined)]), []);
  });

  it('老数据没有 kind 字段,按连接器算(它本来就是)', () => {
    const out = summarizeConnectors([
      sheet('旧表', { server: 'compass-guolu', loadedAt: '2026-07-20T00:00:00Z' }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.server, 'compass-guolu');
  });
});

/**
 * **文件夹即上下文** —— 项目文件夹里躺着的文件,就是这个项目的上下文。
 *
 * 实测发现的洞:上下文栏只列"导入过的原件"和「快照/」。把一份工艺说明直接放进
 * 项目文件夹,它在界面上**根本不出现** —— 于是"在右侧打开"这个入口也就够不着。
 * 我们自己生成的(「生成/」)和可编辑副本(「文稿/」)同样看不见。
 */
describe('文件夹里的文件也算上下文', () => {
  it('列出根目录里能读的文件,并标明它还没导入', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    try {
      writeFileSync(join(dir, '工艺说明.docx'), 'x');
      writeFileSync(join(dir, '.DS_Store'), 'x');       // 噪声不列
      const out = await listProjectFiles(dir);
      const names = out.files.map((f) => f.name);
      assert.ok(names.includes('工艺说明.docx'), `没列出来:${names.join(',')}`);
      assert.ok(!names.includes('.DS_Store'), '把噪声也列了');
      assert.equal(out.files.find((f) => f.name === '工艺说明.docx')!.where, 'folder');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('「生成/」和「文稿/」分开标 —— 三者不是一回事,人要能一眼分清', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    try {
      mkdirSync(join(dir, '生成')); writeFileSync(join(dir, '生成', '汇报.docx'), 'x');
      mkdirSync(join(dir, '文稿')); writeFileSync(join(dir, '文稿', '工艺说明.md'), 'x');
      const out = await listProjectFiles(dir);
      assert.equal(out.files.find((f) => f.name.endsWith('汇报.docx'))?.where, 'generated');
      assert.equal(out.files.find((f) => f.name.endsWith('工艺说明.md'))?.where, 'draft');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('**不列我们自己的仓** —— .veylin 是实现细节,不是给人看的东西', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    try {
      mkdirSync(join(dir, '.veylin')); writeFileSync(join(dir, '.veylin', 'manifest.json'), '{}');
      assert.equal((await listProjectFiles(dir)).files.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('scanProjectGeometry', () => {
  it('列出 CAD 文件,带大小;非几何文件不列', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'geo-'));
    try {
      writeFileSync(join(dir, 'shaft.step'), 'ISO-10303');
      writeFileSync(join(dir, 'flange.STP'), 'x');       // 大小写不敏感
      writeFileSync(join(dir, 'part.stl'), 'x');
      writeFileSync(join(dir, '说明.docx'), 'x');          // 文档不进几何清单
      writeFileSync(join(dir, 'notes.txt'), 'x');
      const out = await scanProjectGeometry(dir);
      assert.deepEqual(out.map((f) => f.name).sort(), ['flange.STP', 'part.stl', 'shaft.step']);
      assert.ok(out.every((f) => f.bytes > 0));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('文件夹不存在不报错,返回空', async () => {
    assert.deepEqual(await scanProjectGeometry('/no/such/folder/xyz'), []);
  });

  it('不下钻子目录 / 不列 .veylin、快照', async () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'geo2-'));
    try {
      mkdirSync(join(dir, '快照')); writeFileSync(join(dir, '快照', 'snap.step'), 'x');
      mkdirSync(join(dir, 'sub')); writeFileSync(join(dir, 'sub', 'deep.step'), 'x');
      writeFileSync(join(dir, 'top.step'), 'x');
      const out = await scanProjectGeometry(dir);
      assert.deepEqual(out.map((f) => f.name), ['top.step']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
