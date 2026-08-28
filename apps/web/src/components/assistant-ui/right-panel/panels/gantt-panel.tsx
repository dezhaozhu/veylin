/**
 * 只读甘特面板 —— 与表格并列,是同一份排产的另一种读法(spec §4)。三视角切换
 * (资源/车间/订单),二级泳道下挂三级子行(没有三级的租户没有这一层,不假装
 * 能展开——见 gantt-window-model.ts 对 `children` 的处理)。
 *
 * **只读**:第一刀不做拖动/插单/改期。那些依赖增量重排 + 治理链路(preview/
 * 提案/版本回退)兜底,先把"看得见"立住(spec §1)。靠 `config.readonly: true`
 * 把拖动关死。
 *
 * **可选依赖**:dhtmlx 走私有源,许可禁止再分发,公开仓不带包
 * (dhtmlx-gantt-loader.ts)。装不到时这里渲染一行说明,不是报错——与 AG-Grid
 * Enterprise 那条缝同形。
 *
 * **诚实标记不许丢**:换控件不等于换口径。late(晚了)/frozen(锁定/人工)/
 * batch(拼炉)三种标记从 toGanttTasks 带出来,画在条上并配一份图例;截断要
 * 明说"这窗口还有 N 条没画",不能悄悄少画。
 */
import { useEffect, useMemo, useRef, useState, type FC, type Ref, useCallback } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { loadDhtmlxGantt, loadDhtmlxGanttCss, type GanttModule } from '@/lib/dhtmlx-gantt-loader';
import { toGanttTasks, type GanttTask, type GanttWindowPayload } from '@/lib/gantt-window-model';
import { ganttErrorMessage, resolveGanttThreadId, ganttWindowUrl, withExpanded } from '@/lib/gantt-request';
import {
  applyGanttTaskFocus,
  ganttFocusRetryDelay,
  jobIdForTask,
  orderIdForTask,
  resolveFocusTarget,
  isTreeToggleTarget,
} from '@/lib/gantt-focus';
import { locateTable } from '@/lib/schedule-locate';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import type { PanelTabsApi } from '@/components/assistant-ui/right-panel/use-panel-tabs';
import type { PanelContentProps } from '../panel-types';

/**
 * dhtmlx-gantt's imperative instance — reached through a `ref` on the
 * `<Gantt>` element, not a prop: v10's `ReactGanttProps` has no click
 * callback (tasks/links/resources/.../className — no onTaskClick; verified
 * against `node_modules/@dhx/react-gantt/dist/dhtmlxgantt.react.es.d.ts` on
 * a machine that has the package installed). The wrapper's own
 * `ReactGanttRef` shape is `{ instance: GanttStatic | null }`.
 *
 * **2026-08-19 追:上一版在这里手写 `useEffect` 读 `ganttRef.current?.instance`
 * 接线,真机(上重 2611 条真数据)证明它坏了——`onTaskClick` 从不回调,直接对
 * 拿到的 instance 调 `getTask` 抛 `Cannot read properties of undefined
 * (reading 'tasksStore')`。根因不是"随便哪个 effect 都会抖",是**挂载时序对
 * 不上**:`<Gantt>` 只在 `load.state === 'ready'` 之后才第一次出现在树里
 * (真数据 fetch 慢,这一刻发生在 GanttPanel 自己早就挂载完之后的一次**更新**
 * 里),而 React 19 StrictMode 的"挂载→卸载→再挂载"双跑只套在**这一次提交里
 * 新出现的 Fiber**上——`<Gantt>` 自己的初始化 effect(内部 `ja.getGanttInstance()`
 * 建一个全新实例)是新出现的,会被双跑:建 instance1→destroy→建 instance2,
 * 最终活着驱动 DOM 的是 instance2。但 GanttPanel 本身在这次提交里只是"更新"
 * (它早挂载过了),它自己声明的 effect 只跑一次——如果这个 effect 就在这一次
 * 单跑里把 `ganttRef.current?.instance` 存进局部变量再 `attachEvent`,拿到的
 * 是 instance1,而 instance1 转眼就被 `<Gantt>` 自己的第二遍挂载销毁掉了。
 * 小 mock 数据不复现,是因为 fetch 够快时 GanttPanel 和 `<Gantt>` 常常在同一
 * 次初始挂载提交里一起出现,那样 GanttPanel 的 effect 也会被同一轮双跑覆盖,
 * 第二遍能重新拿到 instance2——时序偶然对上了,不代表接线本身是对的。
 *
 * **修法**:把"渲染 `<Gantt>` + 接事件线"钉在同一个组件(`GanttChart`,下面)
 * 里,让它们**总在同一次提交里一起挂载/卸载**——StrictMode 双跑就会把两者
 * 一起套进去,第二遍(最终活着的那遍)重新读到的就是真正驱动 DOM 的实例。
 * 官方导出的 `useGanttEvent(ganttRef, eventName, handler)` 正是给这个场景用
 * 的("attach on mount, detach on unmount"),因为它的落点现在跟 `<Gantt>`
 * 同一个组件、同一次挂载,不是因为这个 hook 本身有什么特殊魔法——读过它的
 * 实现(dhtmlxgantt.react.es.js)确认它内部也就是同一个"effect 里读
 * `ganttRef.current?.instance`"的形状,真正起作用的是挂载边界对齐了。用它
 * 而不是手写等价 effect,是因为组件生命周期已定(`GanttChart` 整个生命周期
 * 里 `mod` 恒定存在),按规则调用 hook 没有条件调用的顾虑,直接复用官方实现
 * 省得再维护一份 attach/detach 的样板。
 */
type GanttStaticLike = {
  attachEvent?: (name: string, handler: (id: unknown) => unknown) => string;
  detachEvent?: (id: string) => void;
  isTaskExists?: (id: string) => boolean;
  open?: (id: string) => void;
  showTask?: (id: string) => void;
  selectTask?: (id: string) => void;
};
type GanttRefLike = { instance: GanttStaticLike | null };
/** `useGanttEvent`'s real signature (dhtmlxgantt.react.es.d.ts):
 * `(ganttRef, eventName, handler, options?) => void`. Pulled off the
 * dynamically-`import()`ed module object at runtime — loosely typed like
 * `GanttModule` itself, since the package isn't a build-time dependency this
 * repo can type-check strictly against in every checkout. */
type UseGanttEventFn = (
  ganttRef: { current: GanttRefLike | null },
  eventName: string,
  handler: (...args: unknown[]) => unknown,
) => void;

export type GanttView = 'resource' | 'workshop' | 'order';
export type GanttPanelState = { view?: GanttView };

const VIEWS: GanttView[] = ['resource', 'workshop', 'order'];

/**
 * `open_tree_initially`(评审 2026-08-19,Task 6 遗留):没这条,泳道父行
 * (`type: 'project'`)默认全折叠 —— 打开面板第一眼看到的是一列收起来的泳道
 * 名,看不见任何 bar,而"看得见负荷"正是这个面板存在的理由(spec §1)。
 * 一个模块级常量,避免每次渲染都传一个新的 config 对象字面量给 `<Gantt>`。
 *
 * 30k 级数据下若默认全展开明显卡顿,不要自己降级回折叠 —— 那是下一刀
 * (真数据规模调参)的取舍,这里先如实展开、把观察结果记进报告。
 */
/**
 * `grid_width` / `columns`(2026-08-19 最终评审 F6):**真机诊断实证**,不是
 * 猜的 —— 1512px 笔记本 + 面板默认宽度(拖动手柄裸测出来是 472px,不是文档
 * 写的 400,`chat-panel-ratio-sync.tsx` 会在挂载后把它和聊天区比例同步一次)
 * 时,dhtmlx 自己的任务列表(`.gantt_grid`,不是这一刀关心的 AG-Grid 表格)
 * 用它未设置 `grid_width` 时的内置默认列(Task name / Start time / Duration
 * / 加号)量出来固定吃掉 389px —— 与容器宽度无关,容器越窄,时间轴
 * (`.gantt_task`)剩下的就越少(472px 容器下只剩 64px,不够画出一根 bar 或
 * 一天的刻度)。**验证过不是挂载时序/ResizeObserver 的问题**:真机把面板拖
 * 宽到 921px,`.gantt_grid` 仍然纹丝不动是 389px,`.gantt_task` 跟着长到
 * 514px —— 说明 grid 是固定像素、不随容器缩放,不是"量早了、没重新量"。
 *
 * 修法:显式给列(去掉默认的 Start time 列——开始时间已经是 bar 在时间轴上
 * 的位置,这里的任务列表首要任务是认出"是哪一单",不是复述时间轴已经在说的
 * 事),`text` 用 `'*'` 占满 `grid_width` 里除 `duration` 之外的剩余空间,
 * `grid_width` 从"未设置(即 389px 的内置默认)"降到 190 —— 面板最小宽度
 * (`RIGHT_SIDEBAR_WIDTH_MIN` = 280px)时也能留出 90px 时间轴,默认 472px
 * 时留出约 280px,是之前的四倍多。
 */
const GANTT_CONFIG = {
  readonly: true,
  // 默认会先 showTask 第一条。表格定位刚选中的那条会被它盖掉。
  initial_scroll: false,
  // **逐行 `open` 取代全局自动展开**(见 gantt-window-model 的 lane 行):
  // open_tree_initially 会把二级行也展开,而二级展开 = 去取三级,于是一进面板就把
  // 整屏订单的三级猛拉一遍。现在泳道行自己带 open:true,二级行保持收起。
  // `branch_loading` 让 `$has_child` 生效:子行是"点了才取",没有它,箭头永远不出现。
  branch_loading: true,
  grid_width: 190,
  columns: [
    { name: 'text', tree: true, width: '*', label: 'Task name' },
    { name: 'duration', width: 56, align: 'center', label: 'Duration' },
  ],
};

/** 三种诚实标记对应的视觉表达——工业静音色,不用红绿灯语义(晚了是"要核对
 * 的事实",不是"警报")。Tailwind 类名以字面量出现在这个文件里,构建时能被
 * 扫描到,即便实际拼接发生在运行时。 */
const MARK_CLASSES: Record<string, string> = {
  late: 'border-l-4 border-amber-500',
  frozen: 'bg-slate-200/70 dark:bg-slate-700/50',
  batch: 'ring-1 ring-inset ring-blue-400',
  // 'maxlag'(会凉)与 'overload'(超载)—— spec §5 点名的四种诚实标记里,
  // 之前只画了两种(2026-08-19 最终评审 F3)。overload 落在泳道父行上,用
  // 边框而不是背景/环,免得和它自己下面 late/frozen 的 bar 视觉打架。
  maxlag: 'ring-1 ring-inset ring-rose-400',
  overload: 'border-2 border-dashed border-rose-500',
};

const MARK_LEGEND: Array<{ mark: keyof typeof MARK_CLASSES; dot: string; labelKey: string }> = [
  { mark: 'late', dot: 'bg-amber-500', labelKey: 'panels.gantt.markLate' },
  { mark: 'frozen', dot: 'bg-slate-500', labelKey: 'panels.gantt.markFrozen' },
  { mark: 'batch', dot: 'bg-blue-500', labelKey: 'panels.gantt.markBatch' },
  { mark: 'maxlag', dot: 'bg-rose-400', labelKey: 'panels.gantt.markMaxLag' },
  { mark: 'overload', dot: 'bg-rose-500', labelKey: 'panels.gantt.markOverload' },
];

type Load =
  | { state: 'loading' }
  | { state: 'ready'; payload: GanttWindowPayload }
  | { state: 'error'; message: string };

type Availability = { state: 'checking' } | { state: 'unavailable' } | { state: 'available'; mod: GanttModule };

/** dhtmlx `templates.task_class(start, end, task)` —— 把 `marks` 翻成 CSS 类。
 * 泳道父行和没有标记的条返回空字符串,不加任何装饰。 */
function taskClass(_start: unknown, _end: unknown, task: unknown): string {
  const marks = (task as { marks?: string[] } | undefined)?.marks ?? [];
  return marks
    .map((m) => MARK_CLASSES[m])
    .filter(Boolean)
    .join(' ');
}


/**
 * `<Gantt>` 本体 + 双向定位接线,钉在同一个组件里(见文件头 2026-08-19 追记
 * 的完整推理)——`GanttChart` 只在 `GanttPanel` 判定 `load.state === 'ready'`
 * 之后才被创建,整个生命周期里 `mod` 恒定存在,所以下面对 `mod.useGanttEvent`
 * 的调用是无条件的、每次渲染都跑同一行,不违反 hooks 规则。
 *
 * **INVARIANT —— 不要把这个组件拆成两个**:`<Gantt>` 的渲染和下面这两处事件
 * 接线必须留在同一个组件、同一次挂载周期里。拆开(哪怕只是把
 * `useGanttEvent`/消费 `focusGanttJob` 的那个 effect 挪去父组件或另一个
 * 子组件)会让 StrictMode 双跑的边界重新错开,复现文件头描述的那个"点了没
 * 反应"——症状和上一轮一模一样,而且不会有任何编译期或类型层面的提示。
 */
type GanttChartProps = {
  /** 展开某条二级时回调它的订单号(泳道父行等无订单可展时给 undefined)。 */
  onExpandOrder: (orderId: string | undefined) => void;
  mod: GanttModule;
  tasks: GanttTask[];
  ganttFocus: PanelTabsApi['ganttFocus'];
  clearGanttFocus: PanelTabsApi['clearGanttFocus'];
};

function GanttChart({ mod, tasks, ganttFocus, clearGanttFocus,
                     onExpandOrder }: GanttChartProps) {
  const ganttRef = useRef<GanttRefLike | null>(null);
  const modRecord = mod as Record<string, unknown>;
  const Gantt = modRecord.default as FC<{
    ref?: Ref<GanttRefLike>;
    tasks?: unknown[];
    config?: Record<string, unknown>;
    templates?: Record<string, unknown>;
    className?: string;
  }>;
  const useGanttEvent = modRecord.useGanttEvent as UseGanttEventFn;

  // **`tasksRef`,latest-ref 模式(评审 2026-08-19 追)**:官方 `useGanttEvent`
  // 的依赖数组是 `[ganttRef, eventName]`(读过编译源确认的,见文件头)——不含
  // `handler`,所以传进去的这个箭头函数只在依赖变化时重新 attach,而不是每次
  // 渲染都换一个。如果 handler 直接闭包捕获 `tasks`,一旦出现"`GanttChart`
  // 不卸载、但换了一批新窗口数据"的路径(当前实现里 `tasks` 变化总是伴随一次
  // 完整卸载重挂,但那是**巧合的调用方式**,不是这个组件自己能保证的不变量;
  // 以后加后台刷新/翻页/expand 之类不卸载就换数据的路径),handler 就会拿着
  // 过期的那一批数据去找订单号,查不到就悄悄不动作 —— 又是一次"点了没反应",
  // 而且不会报错。用一个每次渲染都更新的 ref 存最新 `tasks`,handler 从 ref
  // 读而不是从闭包读,这样无论官方 hook 的依赖数组将来怎么写、无论 handler
  // 本身多久重新 attach 一次,查到的永远是当次点击时最新的一批数据。不去改
  // `useGanttEvent` 的调用姿势(比如硬塞 `tasks` 进某个依赖位置)骗它重新
  // attach —— 那是在赌库的实现细节,细节一变这里又得重新踩一遍坑。
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // 甘特 → 表格:点一条 bar,带上作业号(对哪一行)和订单号(作业还没灌到时退回)。
  // 泳道父行两个都没有(jobIdForTask / orderIdForTask 诚实回 undefined),点了不动作。
  // 官方 `useGanttEvent`:attach on mount / detach on unmount,和 `<Gantt>`
  // 同一个组件、同一次挂载生命周期——这正是修复 race 的关键(见文件头)。
  useGanttEvent(ganttRef, 'onTaskClick', (id: unknown, e?: unknown) => {
    // **点展开图标时,跳转要让路。** dhtmlx 不会阻止展开图标的点击冒泡到行级
    // handler,于是同一次点击既触发 onTaskOpened(去取三级)又触发这里(跳表格);
    // 而跳转会把整个甘特面板卸载(右侧面板只挂载当前页签),展开根本来不及渲染。
    // 真机实证 2026-08-25:点箭头 = 没展开 + 莫名跳去表格。
    if (isTreeToggleTarget((e as Event | undefined)?.target)) return true;
    const taskId = String(id);
    const jobId = jobIdForTask(tasksRef.current, taskId);
    const orderId = orderIdForTask(tasksRef.current, taskId);
    if (jobId || orderId) locateTable({ jobId, orderId });
    return true; // 放行默认的选中态,不拦事件
  });

  // 展开一条二级 → 把它的三级取回来。同样顺 parent 链倒查订单号:children 是按
  // **订单**建键的(joint 的 job_id/WBS 属于二级行的 order_id),不是按二级 job_id。
  // 泳道父行没有订单号,展开它不触发取数(orderIdForTask 诚实回 undefined)。
  useGanttEvent(ganttRef, 'onTaskOpened', (id: unknown) => {
    onExpandOrder(orderIdForTask(tasksRef.current, String(id)));
    return true;
  });

  // 表格 → 甘特:消费 focusGanttJob 暂存的 target。`GanttChart` 只在
  // load.state === 'ready' 时才存在,不需要再判一次 load 状态。
  // resolveFocusTarget 找不到就回 null——这里的处理就是"不动",不瞎滚一个
  // (gantt-focus.ts 的核心约束)。实例要等 `<Gantt>` 自己建完;第一次挂载
  // 就 clear 会选在 StrictMode 扔掉的那个 instance 上,人看到的是没选中。
  useEffect(() => {
    if (!ganttFocus) return;
    const targetId = resolveFocusTarget(tasks, ganttFocus.target);
    if (!targetId) {
      if (tasks.length === 0) return;
      clearGanttFocus();
      return;
    }
    const parentId = tasks.find((t) => t.id === targetId)?.parent;
    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;
    const kick = () => {
      if (cancelled) return;
      const delay = ganttFocusRetryDelay(attempt);
      if (delay == null) return;
      attempt += 1;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (applyGanttTaskFocus(ganttRef.current?.instance, targetId, parentId)) {
          clearGanttFocus();
          return;
        }
        kick();
      }, delay);
    };
    kick();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [ganttFocus, tasks, clearGanttFocus]);

  return (
    <Gantt
      ref={ganttRef}
      tasks={tasks}
      config={GANTT_CONFIG}
      templates={{ task_class: taskClass }}
      className="h-full w-full"
    />
  );
}

export const GanttPanel: FC<PanelContentProps> = ({ tab, updateState }) => {
  const { t } = useTranslation();
  // 同 table-grid.tsx / mcp-app-tool.tsx:线程首条消息之前只有本地 composer id,
  // 之后服务端才分配 remoteId/externalId——取错这个会导致"表格看得见、甘特
  // 看不见"。三个原始字段分开取(而不是在 selector 里就 `??` 掉两个),让完整
  // 的 remoteId ?? externalId ?? localId 判定都落在 resolveGanttThreadId 这个
  // 纯函数里,能被单测覆盖。
  const localId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const externalId = useAuiState((s) => s.threadListItem.externalId);
  const threadId = resolveGanttThreadId({ id: localId, remoteId, externalId });

  const panelState = (tab.state ?? {}) as GanttPanelState;
  const view = panelState.view ?? 'resource';
  const { ganttFocus, clearGanttFocus } = usePanelTabs();
  const ganttFocusRef = useRef(ganttFocus);
  ganttFocusRef.current = ganttFocus;

  const [avail, setAvail] = useState<Availability>({ state: 'checking' });
  useEffect(() => {
    let alive = true;
    void loadDhtmlxGantt().then((mod) => {
      if (!alive) return;
      const ok = mod != null && (mod as Record<string, unknown>).default != null;
      setAvail(ok ? { state: 'available', mod: mod as GanttModule } : { state: 'unavailable' });
      // 只有确认 JS 模块真的装了(mod 解出来了)才去拉样式表 —— loadDhtmlxGanttCss
      // 自己的注释解释了为什么这个先后关系是安全的(不会重新踩 vite dev 那个坑)。
      // 没样式不该拖垮整个面板:失败就照旧渲染,fire-and-forget。
      if (ok) void loadDhtmlxGanttCss();
    });
    return () => {
      alive = false;
    };
  }, []);

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  /** 已展开的订单号。换视角时清空 —— 那是另一棵树了。 */
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    if (avail.state !== 'available') return;
    let alive = true;
    setExpanded([]);   // 换视角 = 另一棵树,旧的展开清单不再对应任何父行
    setLoad({ state: 'loading' });
    void (async () => {
      try {
        const focus = ganttFocusRef.current;
        const res = await fetch(
          ganttWindowUrl(threadId, view, expandedRef.current, {
            fromDate: focus?.target.fromDate,
            laneLimit: focus ? 200 : undefined,
          }),
        );
        const body = (await res.json()) as GanttWindowPayload & { ok: boolean; message?: string };
        if (!alive) return;
        if (!body.ok) {
          // 409(没钉项目)/502(Compass 报错)都带一句给人看的话——原样显示,
          // 不要吞掉换成"加载失败"。判定本身在 ganttErrorMessage 里,单测覆盖。
          setLoad({ state: 'error', message: ganttErrorMessage(body, t('panels.gantt.loadFailed')) });
          return;
        }
        setLoad({ state: 'ready', payload: body });
      } catch (err) {
        if (alive) setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail.state, threadId, view]);

  // Hooks below read `tasks`, so it has to be computed before them — and
  // ALL hooks have to run before the avail-state early returns further down
  // (rules of hooks: a component can't call a different number of hooks on
  // different renders).
  //
  // **`useMemo`, not a plain per-render computation** (评审 2026-08-19):
  // `toGanttTasks` always returns a fresh array/object, so without memoizing
  // on `load` alone, EVERY render (switching views, i18n, `updateState`, …)
  // produces a new `tasks` reference — and the two effects below that key off
  // `tasks` (attach/detach the click handler, resolve a pending focus) would
  // tear down and rebuild on each of those unrelated renders. Harmless at toy
  // scale, real churn at 30k tasks. `[load]` is the only real dependency —
  // `toGanttTasks` is pure over `load.payload`.
  // **展开走一条独立的取数路径,绝不碰 `load.state`。**
  //
  // 若图省事复用主 effect(把 `expanded` 加进它的依赖),它会先 `setLoad({loading})`
  // —— 而 `<GanttChart>` 只在 `ready` 时存在,于是图**卸载**、树收起、用户刚展开的
  // 那一条被收回去;他再展开,又卸载一次。展开在界面上永远打不开,而且没有任何报错。
  // 所以这里只在成功后把新 payload 合进 `ready`,让图自始至终挂着(handler 读的是
  // latest-ref,换数据不会拿到过期的那一批)。
  const expandedRef = useRef<string[]>(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    if (expanded.length === 0 || load.state !== 'ready') return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(ganttWindowUrl(threadId, view, expanded));
        const body = (await res.json()) as GanttWindowPayload & { ok: boolean };
        if (!alive || !body.ok) return; // 展开失败就维持现状:树还在,只是没有子行
        setLoad((prev) => (prev.state === 'ready' ? { state: 'ready', payload: body } : prev));
      } catch {
        /* 同上:展开取数失败不该把整张图打掉 */
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, threadId, view]);

  const handleExpandOrder = useCallback((orderId: string | undefined) => {
    setExpanded((cur) => withExpanded(cur, orderId) ?? cur);
  }, []);

  const ready = load.state === 'ready';
  const { tasks, truncatedNote, lanesHidden } = useMemo<{
    tasks: GanttTask[];
    truncatedNote: string | null;
    lanesHidden: number;
  }>(
    () =>
      load.state === 'ready'
        ? toGanttTasks(load.payload)
        : { tasks: [], truncatedNote: null, lanesHidden: 0 },
    [load],
  );
  const droppedCount = ready ? (load.payload.truncated?.bars_dropped ?? 0) : 0;

  // 表格↔甘特双向定位(gantt-focus.ts)。接线(ganttRef + useGanttEvent +
  // 消费 focusGanttJob)全部下沉进 GanttChart —— 理由见文件头那段
  // 2026-08-19 追记:必须让"渲染 `<Gantt>`"和"接事件线"总在同一次挂载/卸载
  // 里发生,不能分属两个组件。
  if (avail.state === 'checking') {
    return <p className="text-muted-foreground p-6 text-sm">{t('panels.gantt.loading')}</p>;
  }
  if (avail.state === 'unavailable') {
    return <p className="text-muted-foreground p-6 text-sm leading-relaxed">{t('panels.gantt.unavailable')}</p>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-2">
        <div className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={v === view ? 'secondary' : 'ghost'}
              aria-pressed={v === view}
              onClick={() => updateState({ view: v })}
            >
              {t(`panels.gantt.view.${v}`)}
            </Button>
          ))}
        </div>
        {/* flex-wrap(2026-08-19 F6 顺带):五种标记在窄面板宽度下放不下一行,
            折成一行 justify-between 会挤爆滚出屏幕 —— 允许换行,别裁掉。 */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {MARK_LEGEND.map(({ mark, dot, labelKey }) => (
            <span key={mark} className="flex items-center gap-1 whitespace-nowrap">
              <span className={`size-2 rounded-full ${dot}`} aria-hidden />
              {t(labelKey)}
            </span>
          ))}
        </div>
      </div>

      {load.state === 'error' && (
        <p className="text-destructive border-border border-b p-3 text-sm leading-relaxed">{load.message}</p>
      )}
      {truncatedNote && (
        <p className="text-muted-foreground bg-muted/40 border-border border-b px-3 py-1.5 text-xs">
          {t('panels.gantt.truncated', { count: droppedCount })}
        </p>
      )}
      {/* 泳道级截断(spec §5 缺口,2026-08-19 最终评审 F5):跟上面那条各说
          各的事实,都为 0 时都不出现。用词按"诚实要用户语言"——说具体域词
          (订单/资源/车间),不说 lane_limit / 泳道级截断这类内部机制词。 */}
      {lanesHidden > 0 && (
        <p className="text-muted-foreground bg-muted/40 border-border border-b px-3 py-1.5 text-xs">
          {t('panels.gantt.lanesHidden', { count: lanesHidden, unit: t(`panels.gantt.lanesHiddenUnit.${view}`) })}
        </p>
      )}

      {/* 出错就不挂甘特区——之前的版本在错误横幅下面还挂着一个 tasks=[] 的空
          <Gantt>,看起来像是"数据是空的"而不是"这次请求失败了"。 */}
      <div className="min-h-0 flex-1">
        {load.state === 'loading' && (
          <p className="text-muted-foreground p-6 text-sm">{t('panels.gantt.loading')}</p>
        )}
        {load.state === 'ready' && (
          <GanttChart
            mod={avail.mod}
            tasks={tasks}
            ganttFocus={ganttFocus}
            clearGanttFocus={clearGanttFocus}
            onExpandOrder={handleExpandOrder}
          />
        )}
      </div>
    </div>
  );
};
