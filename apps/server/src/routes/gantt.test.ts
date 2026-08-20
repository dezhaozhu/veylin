import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGanttQuery, ganttUnavailableMessage } from './gantt.js';

describe('gantt window query', () => {
  it('只把认识的参数传给 Compass —— 别把 threadId 这类本地概念漏过去', () => {
    const q = buildGanttQuery({ threadId: 't1', view: 'resource', days: '90', junk: 'x' });
    assert.deepEqual(Object.keys(q).sort(), ['days', 'view']);
  });

  it('视角不认识就退回 resource,而不是把脏词发给 Compass', () => {
    assert.equal(buildGanttQuery({ view: 'machine' }).view, 'resource');
  });

  it('没钉项目时说人话,而不是回一个空图', () => {
    assert.match(ganttUnavailableMessage(), /项目/);
  });
});
