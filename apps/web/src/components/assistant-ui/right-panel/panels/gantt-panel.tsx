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
import { useEffect, useMemo, useRef, useState, type FC, type Ref } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { loadDhtmlxGantt, loadDhtmlxGanttCss, type GanttModule } from '@/lib/dhtmlx-gantt-loader';
import { toGanttTasks, type GanttTask, type GanttWindowPayload } from '@/lib/gantt-window-model';
import { ganttErrorMessage, resolveGanttThreadId } from '@/lib/gantt-request';
import { orderIdForTask, resolveFocusTarget } from '@/lib/gantt-focus';
import { usePanelTabs } from '@/components/assistant-ui/right-panel/panel-tabs-context';
import type { PanelContentProps } from '../panel-types';

/**
 * dhtmlx-gantt's imperative instance — reached through a `ref` on the
 * `<Gantt>` element, not a prop: v10's `ReactGanttProps` has no click
 * callback (tasks/links/resources/.../className — no onTaskClick; verified
 * against `node_modules/@dhx/react-gantt/dist/dhtmlxgantt.react.es.d.ts` on
 * a machine that has the package installed). The wrapper's own
 * `ReactGanttRef` shape is `{ instance: GanttStatic | null }`, and the
 * package even ships a `useGanttEvent(ganttRef, eventName, handler)` hook
 * built for exactly this — attach on mount, detach on unmount.
 *
 * **Why this file doesn't call that hook**: `useGanttEvent` would have to be
 * pulled off the dynamically-`import()`ed module object (this package is an
 * optional private-registry dependency — see dhx-react-gantt.d.ts — so it's
 * never statically imported), and a hook reached that way isn't safe to call
 * unconditionally every render: before `avail` resolves it doesn't exist yet,
 * and calling `undefined(...)` — or skipping the call — makes the number of
 * hooks invoked differ between renders, which breaks React's hook-order
 * invariant. A plain `useEffect` (one of THIS component's own hooks, always
 * called) reading `ganttRef.current?.instance.attachEvent/detachEvent`
 * itself sidesteps that entirely and is what `useGanttEvent` does internally
 * anyway. Loosely typed: the package isn't a build-time dependency this repo
 * can type-check strictly against.
 */
type GanttStaticLike = {
  attachEvent?: (name: string, handler: (id: unknown) => unknown) => string;
  detachEvent?: (id: string) => void;
  showTask?: (id: string) => void;
  selectTask?: (id: string) => void;
};
type GanttRefLike = { instance: GanttStaticLike | null };

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
const GANTT_CONFIG = { readonly: true, open_tree_initially: true };

/** 三种诚实标记对应的视觉表达——工业静音色,不用红绿灯语义(晚了是"要核对
 * 的事实",不是"警报")。Tailwind 类名以字面量出现在这个文件里,构建时能被
 * 扫描到,即便实际拼接发生在运行时。 */
const MARK_CLASSES: Record<string, string> = {
  late: 'border-l-4 border-amber-500',
  frozen: 'bg-slate-200/70 dark:bg-slate-700/50',
  batch: 'ring-1 ring-inset ring-blue-400',
};

const MARK_LEGEND: Array<{ mark: keyof typeof MARK_CLASSES; dot: string; labelKey: string }> = [
  { mark: 'late', dot: 'bg-amber-500', labelKey: 'panels.gantt.markLate' },
  { mark: 'frozen', dot: 'bg-slate-500', labelKey: 'panels.gantt.markFrozen' },
  { mark: 'batch', dot: 'bg-blue-500', labelKey: 'panels.gantt.markBatch' },
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

function ganttWindowUrl(threadId: string | undefined, view: GanttView): string {
  const q = new URLSearchParams({ view });
  if (threadId) q.set('threadId', threadId);
  return `/api/gantt/window?${q}`;
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
  useEffect(() => {
    if (avail.state !== 'available') return;
    let alive = true;
    setLoad({ state: 'loading' });
    void (async () => {
      try {
        const res = await fetch(ganttWindowUrl(threadId, view));
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
  const ready = load.state === 'ready';
  const { tasks, truncatedNote } = useMemo<{ tasks: GanttTask[]; truncatedNote: string | null }>(
    () => (load.state === 'ready' ? toGanttTasks(load.payload) : { tasks: [], truncatedNote: null }),
    [load],
  );
  const droppedCount = ready ? (load.payload.truncated?.bars_dropped ?? 0) : 0;

  // 表格↔甘特双向定位(gantt-focus.ts)。
  const { focusScheduleFilter, ganttFocus, clearGanttFocus } = usePanelTabs();
  // Populated by React when `<Gantt ref={ganttRef}>` mounts (only once
  // load.state === 'ready' — see the JSX below); null until then.
  const ganttRef = useRef<GanttRefLike | null>(null);

  // 甘特 → 表格:点一条 bar,顺 parent 链倒查它的订单号,复用已有的
  // focusScheduleFilter 定位路径 —— 不另造一套(见该函数的调用处说明)。
  // 泳道父行没有订单号可言(orderIdForTask 对它诚实回 undefined),点了不动作。
  // `tasks` in the deps re-runs this whenever a fresh window lands (including
  // the very first time `<Gantt>` actually mounts and populates ganttRef).
  useEffect(() => {
    const instance = ganttRef.current?.instance;
    if (!instance || typeof instance.attachEvent !== 'function') return;
    const handlerId = instance.attachEvent('onTaskClick', (id: unknown) => {
      const orderId = orderIdForTask(tasks, String(id));
      if (orderId) void focusScheduleFilter({ order_id: orderId });
      return true; // 放行默认的选中态,不拦事件
    });
    return () => {
      if (typeof instance.detachEvent === 'function') instance.detachEvent(handlerId);
    };
  }, [tasks, focusScheduleFilter]);

  // 表格 → 甘特:消费 focusGanttJob 暂存的 target。等这一窗数据落地
  // (load.state === 'ready')再判定,不对着还没到位的空 tasks 误判"找不到"。
  // resolveFocusTarget 找不到就回 null——这里的处理就是"不动",不瞎滚一个
  // (gantt-focus.ts 的核心约束)。只尝试一次:同一窗口内不会因为再等等就
  // 突然命中,真找不到留给"换窗口"的后续工作(task 7 之外)。
  useEffect(() => {
    if (!ganttFocus) return;
    if (load.state !== 'ready') return;
    const targetId = resolveFocusTarget(tasks, ganttFocus.target);
    clearGanttFocus();
    if (!targetId) return;
    const instance = ganttRef.current?.instance;
    try {
      instance?.showTask?.(targetId);
    } catch {
      /* best-effort scroll-into-view */
    }
    try {
      instance?.selectTask?.(targetId);
    } catch {
      /* best-effort highlight */
    }
  }, [ganttFocus, load, tasks, clearGanttFocus]);

  if (avail.state === 'checking') {
    return <p className="text-muted-foreground p-6 text-sm">{t('panels.gantt.loading')}</p>;
  }
  if (avail.state === 'unavailable') {
    return <p className="text-muted-foreground p-6 text-sm leading-relaxed">{t('panels.gantt.unavailable')}</p>;
  }

  const Gantt = (avail.mod as Record<string, unknown>).default as FC<{
    ref?: Ref<GanttRefLike>;
    tasks?: unknown[];
    config?: Record<string, unknown>;
    templates?: Record<string, unknown>;
    className?: string;
  }>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between gap-2 border-b p-2">
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
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          {MARK_LEGEND.map(({ mark, dot, labelKey }) => (
            <span key={mark} className="flex items-center gap-1">
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

      {/* 出错就不挂甘特区——之前的版本在错误横幅下面还挂着一个 tasks=[] 的空
          <Gantt>,看起来像是"数据是空的"而不是"这次请求失败了"。 */}
      <div className="min-h-0 flex-1">
        {load.state === 'loading' && (
          <p className="text-muted-foreground p-6 text-sm">{t('panels.gantt.loading')}</p>
        )}
        {load.state === 'ready' && (
          <Gantt
            ref={ganttRef}
            tasks={tasks}
            config={GANTT_CONFIG}
            templates={{ task_class: taskClass }}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  );
};
