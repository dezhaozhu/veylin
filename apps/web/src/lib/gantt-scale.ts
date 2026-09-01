/**
 * 甘特时间轴刻度。默认不设 min_column_width 时,dhtmlx 把整段排产挤进右栏
 * 宽度,日格变成几像素,条细到看不见 —— 右栏又没有 Compass 那套日/周/月切换。
 * 刻度是显示层,不改 /api/gantt/window 取数窗口。
 */
export const GANTT_SCALE_LEVELS = ['day', 'week', 'month'] as const;
export type GanttScaleLevel = (typeof GANTT_SCALE_LEVELS)[number];

/** 看不清时先落到日:列够宽,时间轴横向滚,而不是整年压进一屏。 */
export const DEFAULT_GANTT_SCALE: GanttScaleLevel = 'day';

const SCALE_SET = new Set<string>(GANTT_SCALE_LEVELS);

export function resolveGanttScale(raw: unknown): GanttScaleLevel {
  return typeof raw === 'string' && SCALE_SET.has(raw) ? (raw as GanttScaleLevel) : DEFAULT_GANTT_SCALE;
}

type ScaleRow = { unit: string; step: number; format: string };

const SCALES: Record<GanttScaleLevel, { min_column_width: number; scales: ScaleRow[] }> = {
  day: {
    min_column_width: 48,
    scales: [
      { unit: 'month', step: 1, format: '%Y-%m' },
      { unit: 'day', step: 1, format: '%d' },
    ],
  },
  week: {
    min_column_width: 56,
    scales: [
      { unit: 'month', step: 1, format: '%Y-%m' },
      { unit: 'week', step: 1, format: '%W' },
    ],
  },
  month: {
    min_column_width: 72,
    scales: [
      { unit: 'year', step: 1, format: '%Y' },
      { unit: 'month', step: 1, format: '%m' },
    ],
  },
};

/** 交给 <Gantt config> 的整份配置。只读和列宽与原先 GANTT_CONFIG 对齐。 */
export function ganttChartConfig(scale: GanttScaleLevel): Record<string, unknown> {
  const { min_column_width, scales } = SCALES[scale];
  return {
    readonly: true,
    // 默认会先 showTask 第一条。表格定位刚选中的那条会被它盖掉。
    initial_scroll: false,
    // 不许为了「一屏看完全程」把列压扁。
    fit_tasks: false,
    branch_loading: true,
    grid_width: 190,
    scale_height: 56,
    min_column_width,
    scales,
    columns: [
      { name: 'text', tree: true, width: '*', label: 'Task name' },
      { name: 'duration', width: 56, align: 'center', label: 'Duration' },
    ],
  };
}
