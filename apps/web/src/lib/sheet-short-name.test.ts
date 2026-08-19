import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortSheetName, isSheet, findSheetIdByShortName } from './sheet-short-name.js';

describe('sheet short name', () => {
  it('剥掉归属前缀', () => {
    assert.equal(shortSheetName('p_8657aa7d-8279-472d-9a9d-a71544c0f217~schedule'), 'schedule');
    assert.equal(shortSheetName('t_abc~orders'), 'orders');
    assert.equal(shortSheetName('me~schedule'), 'schedule');
  });

  it('没有前缀的老 id 原样返回', () => {
    assert.equal(shortSheetName('schedule'), 'schedule');
    assert.equal(shortSheetName(undefined), '');
  });

  it('不认识的前缀不当作用域剥 —— 名字里本来就带 ~ 的表不能被切一刀', () => {
    assert.equal(shortSheetName('二级计划~原表'), '二级计划~原表');
  });

  it('项目里的 schedule 仍然是 schedule —— 二三级展开就是栽在这一条上', () => {
    assert.ok(isSheet('p_8657aa7d~schedule', 'schedule'));
    assert.ok(isSheet('schedule', 'schedule'));
    assert.ok(!isSheet('p_8657aa7d~orders', 'schedule'));
  });

  it('切表要拿到真 id,不是短名', () => {
    const sheets = [{ id: 'p_x~orders' }, { id: 'p_x~schedule' }];
    assert.equal(findSheetIdByShortName(sheets, 'schedule'), 'p_x~schedule');
    assert.equal(findSheetIdByShortName(sheets, 'nope'), undefined);
  });
});
