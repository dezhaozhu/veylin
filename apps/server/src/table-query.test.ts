/**
 * 查一张表,而不是翻它。
 *
 * 导入的表现在只能 `table_get(offset, limit≤200)` —— 四万九千行要翻 247 次,
 * 等于读不了。Compass 自己的数据早就有筛选口径(get_schedule_rows(workshop=…)),
 * 用户导进来的表却没有。这里补上,**口径照 Compass 那边**:
 *
 *  - `matched` 是筛完的真数,不是这次给了几行;
 *  - 列名写错要**说出来并拒绝**,不能静默当没筛(那会把"没筛到"讲成"没有");
 *  - 分组计数是认识一张陌生表的入口:先问"这列都有哪些值、各多少行"。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queryTableRows } from './table-query.js';

const columns = ['工厂名称', 'WBS', '期量天数'];
const rows = [
  { row_id: 'r1', 工厂名称: '金工分厂', WBS: 'T-1', 期量天数: '30' },
  { row_id: 'r2', 工厂名称: '锻件分厂', WBS: 'T-2', 期量天数: '45' },
  { row_id: 'r3', 工厂名称: '金工分厂', WBS: 'T-3', 期量天数: '5' },
  { row_id: 'r4', 工厂名称: '大锻所', WBS: 'T-4', 期量天数: '' },
];

describe('筛选', () => {
  it('等于', () => {
    const out = queryTableRows(rows, columns, {
      filters: [{ column: '工厂名称', op: 'eq', value: '金工分厂' }],
    });
    assert.equal(out.matched, 2);
    assert.deepEqual(out.rows.map((r) => r['WBS']), ['T-1', 'T-3']);
  });

  it('包含', () => {
    const out = queryTableRows(rows, columns, {
      filters: [{ column: '工厂名称', op: 'contains', value: '分厂' }],
    });
    // 金工分厂 ×2 + 锻件分厂 ×1 —— 大锻所不含"分厂"
    assert.equal(out.matched, 3);
  });

  it('数值比较按数值来,不是按字符串("5" 不该大于 "30")', () => {
    const out = queryTableRows(rows, columns, {
      filters: [{ column: '期量天数', op: 'gt', value: '10' }],
    });
    assert.deepEqual(out.rows.map((r) => r['WBS']), ['T-1', 'T-2']);
  });

  it('空 / 非空', () => {
    assert.equal(queryTableRows(rows, columns, {
      filters: [{ column: '期量天数', op: 'empty' }],
    }).matched, 1);
    assert.equal(queryTableRows(rows, columns, {
      filters: [{ column: '期量天数', op: 'nonempty' }],
    }).matched, 3);
  });

  it('多个条件是**且**', () => {
    const out = queryTableRows(rows, columns, {
      filters: [
        { column: '工厂名称', op: 'eq', value: '金工分厂' },
        { column: '期量天数', op: 'gt', value: '10' },
      ],
    });
    assert.deepEqual(out.rows.map((r) => r['WBS']), ['T-1']);
  });
});

describe('列名写错', () => {
  it('**拒绝**并列出可用列 —— 静默忽略会把"没筛到"讲成"没有"', () => {
    const out = queryTableRows(rows, columns, {
      filters: [{ column: '分厂', op: 'eq', value: '金工分厂' }],
    });
    assert.equal(out.refused, true);
    assert.deepEqual(out.unknownColumns, ['分厂']);
    assert.deepEqual(out.rows, []);
    assert.match(out.message ?? '', /工厂名称/, '要把可用列摆出来,人才知道该写什么');
  });

  it('分组列写错同样拒绝', () => {
    const out = queryTableRows(rows, columns, { groupBy: '没这列' });
    assert.equal(out.refused, true);
  });
});

describe('分组计数 —— 认识一张陌生表的入口', () => {
  it('按列分组,按数量降序', () => {
    const out = queryTableRows(rows, columns, { groupBy: '工厂名称' });
    assert.deepEqual(out.groups, [
      { value: '金工分厂', count: 2 },
      { value: '大锻所', count: 1 },
      { value: '锻件分厂', count: 1 },
    ]);
    assert.equal(out.groupsTotal, 3);
  });

  it('分组太多时截断,但**把总数说出来**', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ row_id: `r${i}`, WBS: `W${i}`, 工厂名称: `厂${i}`, 期量天数: '1' }));
    const out = queryTableRows(many, columns, { groupBy: '工厂名称', groupLimit: 10 });
    assert.equal(out.groups!.length, 10);
    assert.equal(out.groupsTotal, 50, '截断了要说清楚一共多少组');
  });

  it('先筛后分组', () => {
    const out = queryTableRows(rows, columns, {
      filters: [{ column: '期量天数', op: 'nonempty' }],
      groupBy: '工厂名称',
    });
    assert.deepEqual(out.groups, [
      { value: '金工分厂', count: 2 },
      { value: '锻件分厂', count: 1 },
    ]);
  });
});

describe('分页与列裁剪', () => {
  it('matched 是筛完的真数,returned 是这次给了几行', () => {
    const out = queryTableRows(rows, columns, { limit: 1 });
    assert.equal(out.matched, 4);
    assert.equal(out.returned, 1);
    assert.equal(out.rows.length, 1);
  });

  it('offset 往后翻', () => {
    const out = queryTableRows(rows, columns, { limit: 2, offset: 2 });
    assert.deepEqual(out.rows.map((r) => r['WBS']), ['T-3', 'T-4']);
  });

  it('只要指定的列(省 token)', () => {
    const out = queryTableRows(rows, columns, { columns: ['WBS'], limit: 1 });
    assert.deepEqual(Object.keys(out.rows[0]!), ['WBS']);
  });

  it('只要计数时可以一行不给', () => {
    const out = queryTableRows(rows, columns, {
      filters: [{ column: '工厂名称', op: 'eq', value: '金工分厂' }],
      limit: 0,
    });
    assert.equal(out.matched, 2);
    assert.deepEqual(out.rows, []);
  });
});
