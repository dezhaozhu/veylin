/**
 * `/api/gantt/window` 的 payload → dhtmlx 的 tasks。纯函数,便于单测——不碰
 * fetch、不碰 i18n,只做数据形状转换。文案(截断提示的具体措辞、三视角标签)
 * 留给面板用 i18n 拼,这里只给出"有没有被截断"这个信号 + 一句参考文案。
 */
export type GanttTask = {
  id: string;
  text: string;
  start_date: string;
  end_date: string;
  parent?: string;
  type?: 'project' | 'task';
  /** 诚实标记:'late' | 'frozen' | 'batch'。换控件不等于换口径,这三种从
   * payload 带到这里,一个都不能丢。 */
  marks: string[];
  /**
   * 订单号 —— 只有二级那条 bar 才带(泳道父行、三级子行不需要)。下一刀
   * (表格↔甘特双向定位)要按订单号在两边对齐,没有这个字段就实现不了
   * (2026-08-19 控制方裁定,见 task-6-brief.md 的增补)。
   */
  orderId?: string;
};

export type GanttBar = {
  job_id: string;
  order_id: string;
  label: string;
  start: string;
  end: string;
  resource?: string | null;
  late_days?: number;
  frozen?: boolean;
  batch_id?: string | null;
  /** 三级子行(work_orders)。没有三级的租户(如锅炉)这个键干脆不存在——
   * 不要给它兜底成 `[]`,那等于假装能展开。 */
  children?: Array<Record<string, unknown>>;
};

export type GanttLane = {
  lane: string;
  kind?: string;
  total_bars: number;
  bars: GanttBar[];
};

/** `GET /api/gantt/window` 成功响应的形状(面板据此发请求、这里据此转换)。 */
export type GanttWindowPayload = {
  ok?: boolean;
  meta?: { view?: string; lane_total?: number; status?: string; [k: string]: unknown };
  lanes?: GanttLane[];
  batches?: unknown[];
  violations?: unknown;
  truncated?: { bars_dropped?: number } | null;
};

export function toGanttTasks(payload: GanttWindowPayload): {
  tasks: GanttTask[];
  truncatedNote: string | null;
} {
  const tasks: GanttTask[] = [];
  for (const lane of payload.lanes ?? []) {
    tasks.push({
      id: `lane:${lane.lane}`,
      text: lane.lane,
      type: 'project',
      start_date: lane.bars[0]?.start ?? '',
      end_date: lane.bars[0]?.end ?? '',
      marks: [],
    });
    for (const b of lane.bars) {
      const marks: string[] = [];
      if ((b.late_days ?? 0) > 0) marks.push('late');
      if (b.frozen) marks.push('frozen');
      if (b.batch_id) marks.push('batch');
      tasks.push({
        id: `job:${b.job_id}`,
        text: b.label,
        parent: `lane:${lane.lane}`,
        orderId: b.order_id,
        start_date: b.start,
        end_date: b.end,
        marks,
      });
      for (const c of b.children ?? []) {
        tasks.push({
          id: `wo:${String(c.work_order_id)}`,
          text: String(c.op_name ?? ''),
          parent: `job:${b.job_id}`,
          start_date: String(c.planned_start ?? c.start ?? b.start),
          end_date: String(c.planned_end ?? c.end ?? b.end),
          marks: [],
        });
      }
    }
  }
  const dropped = payload.truncated?.bars_dropped ?? 0;
  return { tasks, truncatedNote: dropped ? `本窗口还有 ${dropped} 条未显示` : null };
}
