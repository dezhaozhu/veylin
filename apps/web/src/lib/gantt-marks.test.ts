import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GANTT_MARK_CLASSES, ganttTaskClass } from './gantt-marks';

describe('ganttTaskClass', () => {
  it('没有标记的条不加任何装饰', () => {
    assert.equal(ganttTaskClass({ marks: [] }), '');
  });

  it('泳道父行和缺字段的 task 都不报错,回空串', () => {
    assert.equal(ganttTaskClass({}), '');
    assert.equal(ganttTaskClass(undefined), '');
  });

  it('多个标记叠在一条上', () => {
    assert.equal(ganttTaskClass({ marks: ['late', 'batch'] }), 'vg-late vg-batch');
  });

  it('认不出的标记被丢掉,不拼出 undefined', () => {
    assert.equal(ganttTaskClass({ marks: ['late', 'nope'] }), 'vg-late');
  });

  /** 五种标记都必须有对应的类 —— 少一个就是那一种标记又变成看不见的。 */
  it('gantt-window-model 产出的五种标记全都有映射', () => {
    for (const mark of ['late', 'frozen', 'batch', 'maxlag', 'overload']) {
      assert.ok(GANTT_MARK_CLASSES[mark], `${mark} 没有对应的 CSS 类`);
    }
  });
});
