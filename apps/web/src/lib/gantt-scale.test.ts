import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GANTT_SCALE,
  GANTT_SCALE_LEVELS,
  ganttChartConfig,
  resolveGanttScale,
  type GanttScaleLevel,
} from './gantt-scale.js';

describe('resolveGanttScale', () => {
  it('认日周月,别的一律落回默认(日)', () => {
    assert.equal(resolveGanttScale('day'), 'day');
    assert.equal(resolveGanttScale('week'), 'week');
    assert.equal(resolveGanttScale('month'), 'month');
    assert.equal(resolveGanttScale('year'), DEFAULT_GANTT_SCALE);
    assert.equal(resolveGanttScale(undefined), DEFAULT_GANTT_SCALE);
    assert.equal(DEFAULT_GANTT_SCALE, 'day');
  });
});

describe('ganttChartConfig —— 刻度列有最小宽度,不许把整段排产挤进面板', () => {
  for (const level of GANTT_SCALE_LEVELS) {
    it(`${level} 有 min_column_width,时间轴该横向滚而不是压扁`, () => {
      const cfg = ganttChartConfig(level);
      assert.equal(typeof cfg.min_column_width, 'number');
      assert.ok((cfg.min_column_width as number) >= 40);
      assert.equal(cfg.fit_tasks, false);
      assert.equal(cfg.readonly, true);
      const scales = cfg.scales as Array<{ unit: string }>;
      assert.ok(Array.isArray(scales) && scales.length >= 1);
    });
  }

  it('日刻度底层单位是 day,周/月不会误用日格把列挤没', () => {
    const units = (level: GanttScaleLevel) =>
      (ganttChartConfig(level).scales as Array<{ unit: string }>).map((s) => s.unit);
    assert.ok(units('day').includes('day'));
    assert.ok(units('week').includes('week'));
    assert.ok(units('month').includes('month'));
  });
});
