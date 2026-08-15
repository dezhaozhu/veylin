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
import { summarizeConnectors } from './project-context.js';

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
