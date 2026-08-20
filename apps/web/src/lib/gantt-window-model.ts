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
  /** 诚实标记:'late' | 'frozen' | 'batch' | 'maxlag' | 'overload'。换控件不
   * 等于换口径,spec §5 点名的四种(拼炉/会凉/超载/锁定)都要有对应表达——
   * 'maxlag'(会凉,violations.max_lag 命中的那根 bar)与 'overload'(超载,
   * violations.cap_overloads 命中的泳道父行,cap_overloads 只聚合到
   * resource+month,定位不到具体哪根 bar)是 2026-08-19 最终评审 F3 补的。 */
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

/**
 * `violations`(gantt_service.py 的 `build_gantt` 尾部,`{"violations": {"max_lag":
 * max_lag, "cap_overloads": overloads}}`)。真机核对过顶层两个键名(shangzhong/
 * guolu 当前活跑都是空数组,字段本身在);逐项形状按后端源码 + tests/api/
 * test_gantt_service.py 的样例钉定:
 * - `max_lag[]` 每项带 `task_id`(= bar 的 job_id,`_greedy_order`/greedy.py 里
 *   `t.task_id` 就是 job 的 id,不是三级 work_order 的 id)。
 * - `cap_overloads[]` 是按 resource+month 聚合过的(gantt_service.py 里丢了
 *   task_id),只能定位到"哪条泳道、哪个月超载",定位不到具体哪根 bar —— 所以
 *   标记只能落在泳道父行,不是某根 bar。
 */
export type GanttViolations = {
  max_lag?: Array<{ task_id?: string; [k: string]: unknown }>;
  cap_overloads?: Array<{ resource?: string; month?: string; over?: number; [k: string]: unknown }>;
};

/** `GET /api/gantt/window` 成功响应的形状(面板据此发请求、这里据此转换)。 */
export type GanttWindowPayload = {
  ok?: boolean;
  meta?: { view?: string; lane_total?: number; status?: string; [k: string]: unknown };
  lanes?: GanttLane[];
  batches?: unknown[];
  violations?: GanttViolations;
  truncated?: { bars_dropped?: number } | null;
};

export function toGanttTasks(payload: GanttWindowPayload): {
  tasks: GanttTask[];
  truncatedNote: string | null;
  /** 泳道级被藏起来的条数(spec §5 缺口,2026-08-19 最终评审 F5 补):
   * `meta.lane_total`(该视角真实泳道总数)与实际返回的 `lanes.length`
   * (被 `lane_limit` 分页截住的那部分)之差。order 视角 4,218 条泳道、
   * `lane_limit=20` 时这个数字是 4,198 —— 之前 `truncatedNote` 只看
   * `truncated.bars_dropped`(泳道内条数截断),对这一种截断零感知,
   * 面板会悄悄只画 0.5% 的订单却不说。 */
  lanesHidden: number;
} {
  const tasks: GanttTask[] = [];
  const maxLagTaskIds = new Set(
    (payload.violations?.max_lag ?? [])
      .map((v) => v.task_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const overloadedResources = new Set(
    (payload.violations?.cap_overloads ?? [])
      .map((o) => o.resource)
      .filter((r): r is string => typeof r === 'string' && r.length > 0),
  );
  for (const lane of payload.lanes ?? []) {
    const laneMarks: string[] = [];
    if (overloadedResources.has(lane.lane)) laneMarks.push('overload');
    tasks.push({
      id: `lane:${lane.lane}`,
      text: lane.lane,
      type: 'project',
      start_date: lane.bars[0]?.start ?? '',
      end_date: lane.bars[0]?.end ?? '',
      marks: laneMarks,
    });
    for (const b of lane.bars) {
      const marks: string[] = [];
      if ((b.late_days ?? 0) > 0) marks.push('late');
      if (b.frozen) marks.push('frozen');
      if (b.batch_id) marks.push('batch');
      if (maxLagTaskIds.has(b.job_id)) marks.push('maxlag');
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
  const laneTotal = payload.meta?.lane_total ?? (payload.lanes ?? []).length;
  const lanesHidden = Math.max(0, laneTotal - (payload.lanes ?? []).length);
  return {
    tasks,
    truncatedNote: dropped ? `本窗口还有 ${dropped} 条未显示` : null,
    lanesHidden,
  };
}
