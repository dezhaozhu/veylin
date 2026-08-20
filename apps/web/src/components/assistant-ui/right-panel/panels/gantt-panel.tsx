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
import { useEffect, useState, type FC } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { loadDhtmlxGantt, type GanttModule } from '@/lib/dhtmlx-gantt-loader';
import { toGanttTasks, type GanttTask, type GanttWindowPayload } from '@/lib/gantt-window-model';
import { ganttErrorMessage, resolveGanttThreadId } from '@/lib/gantt-request';
import type { PanelContentProps } from '../panel-types';

export type GanttView = 'resource' | 'workshop' | 'order';
export type GanttPanelState = { view?: GanttView };

const VIEWS: GanttView[] = ['resource', 'workshop', 'order'];

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

  if (avail.state === 'checking') {
    return <p className="text-muted-foreground p-6 text-sm">{t('panels.gantt.loading')}</p>;
  }
  if (avail.state === 'unavailable') {
    return <p className="text-muted-foreground p-6 text-sm leading-relaxed">{t('panels.gantt.unavailable')}</p>;
  }

  const ready = load.state === 'ready';
  const { tasks, truncatedNote }: { tasks: GanttTask[]; truncatedNote: string | null } = ready
    ? toGanttTasks(load.payload)
    : { tasks: [], truncatedNote: null };
  const droppedCount = ready ? (load.payload.truncated?.bars_dropped ?? 0) : 0;

  const Gantt = (avail.mod as Record<string, unknown>).default as FC<{
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
          <Gantt tasks={tasks} config={{ readonly: true }} templates={{ task_class: taskClass }} className="h-full w-full" />
        )}
      </div>
    </div>
  );
};
