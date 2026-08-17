/**
 * **项目的数据源只能加,不能换、不能删。**
 *
 * 用户定的,理由比"managed 项目改不了"更根本:一个项目里前 10 条对话读的是上重,
 * 把数据源换成锅炉之后再问,**那 10 条对话的结论就全对不上了** —— 而它们还在
 * 那儿,看起来像是同一个项目的连续记录。项目的数据源是它的身份,不是一个设置项。
 *
 * 为什么"加"可以:从"没有"到"有"是首次挂载(此前没有靠数据得出的结论);
 * 再加一个是**加宽**,原来读过的数据还在,老结论仍然成立。换/删才会让历史失真。
 * 要换 → 新建一个项目,代价很低。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkSourcesChange } from './project-sources-immutable.js';

describe('checkSourcesChange', () => {
  it('首次挂载:从没有到有 —— 允许', () => {
    assert.equal(checkSourcesChange([], ['shangzhong']), null);
  });

  it('加宽:再挂一个 —— 允许(老结论仍然成立)', () => {
    assert.equal(checkSourcesChange(['shangzhong'], ['shangzhong', 'guolu']), null);
  });

  it('**换掉 —— 拒**,并说清为什么和该怎么办', () => {
    const err = checkSourcesChange(['shangzhong'], ['guolu']);
    assert.ok(err);
    assert.match(err!, /之前的对话|历史|对不上/);
    assert.match(err!, /新建/);
  });

  it('**摘掉 —— 拒**', () => {
    assert.ok(checkSourcesChange(['shangzhong', 'guolu'], ['shangzhong']));
  });

  it('**清空 —— 拒**(最容易被当成"重置一下"的那个动作)', () => {
    assert.ok(checkSourcesChange(['shangzhong'], []));
  });

  it('原样提交不算改动 —— 不该因为顺序不同就拒', () => {
    assert.equal(checkSourcesChange(['a', 'b'], ['b', 'a']), null);
  });
});
