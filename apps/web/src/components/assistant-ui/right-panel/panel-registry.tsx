/**
 * Right-panel content registry.
 *
 * Tab responsibilities (do not overlap):
 * | Tab       | Role                                      | vs Automate                          |
 * |-----------|-------------------------------------------|--------------------------------------|
 * | Table     | Editable spreadsheet grid (table store)   | Automate = single-step cron/event    |
 * | Gantt     | READ-ONLY resource Gantt(dhtmlx,可选依赖装不到就不出现)|                       |
 * | Web       | Embedded browser for read_open_page       |   -> Agent prompt, separate storage  |
 * | Knowledge | RAG upload, search, citations + KG        | Workflow = multi-step executable DAG |
 * | Workflow  | Visual DAG editor + real execution engine | Both share InProcQueue / cron / hook |
 * | Doc       | READ-ONLY 文档(Word/PPT/PDF)。表格那格是编辑面,这格不是 —— 没人要 |
 * |           | 在这里编辑一份 docx 再写回去;要改走"改在副本上、按需导出"。      |
 *
 * label/description/defaultTitle hold i18n keys, resolved with t() at render.
 */
import { BarChart3, BookOpen, Box, FileText, Globe, SquareGanttChart, Table, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { TableGrid } from '@/components/assistant-ui/table-grid';
import { WebBrowserPanel } from '@/components/assistant-ui/right-panel/panels/web-browser-panel';
import { RagPanel } from '@/components/assistant-ui/right-panel/panels/rag-panel';
import { WorkflowPanel } from '@/components/assistant-ui/right-panel/panels/workflow-panel';
import { Viewer3dPanel } from '@/components/assistant-ui/right-panel/panels/viewer3d-panel';
import { DocPanel } from '@/components/assistant-ui/right-panel/panels/doc-panel';
import { WidgetPanel } from '@/components/assistant-ui/right-panel/panels/widget-panel';
import { GanttPanel } from '@/components/assistant-ui/right-panel/panels/gantt-panel';
import { isDhtmlxAvailable } from '@/lib/dhtmlx-gantt-loader';
import type { PanelContentProps, PanelKind, PanelKindDef } from './panel-types';

// Fork seam: our AG-Grid TableGrid manages its own sheet tabs (workspace-wide,
// including Compass-imported global sheets), so it takes no per-session props.
function TablePanel(_props: PanelContentProps) {
  return <TableGrid />;
}

function WebPanel(props: PanelContentProps) {
  return <WebBrowserPanel {...props} />;
}

function RagPanelEntry(props: PanelContentProps) {
  return <RagPanel {...props} />;
}

function WorkflowPanelEntry(props: PanelContentProps) {
  return <WorkflowPanel {...props} />;
}

function Viewer3dPanelEntry(props: PanelContentProps) {
  return <Viewer3dPanel {...props} />;
}

function GanttPanelEntry(props: PanelContentProps) {
  return <GanttPanel {...props} />;
}

/** All registered panel kinds. Order drives the "+" menu. */
export const PANEL_KINDS: PanelKindDef[] = [
  {
    kind: 'table',
    label: 'panels.table.label',
    description: 'panels.table.desc',
    icon: <Table className="size-4" />,
    defaultTitle: 'panels.table.label',
    // Sheet is created when the user opens a table tab (+), then bound here.
    createState: () => ({ sheetId: null as string | null }),
    Component: TablePanel,
  },
  {
    // 与表格并列的另一种读法(spec §4)——只读渲染,第一刀不做拖动/插单。
    // dhtmlx 是可选依赖(私有源、许可禁止再分发)。**这个条目在 PANEL_KINDS
    // 里始终注册**——`getPanelKindDef('gantt')` 必须永远能解析,否则一个在
    // 装了包的机器上创建、后来被同步/持久化到没装包的机器上的甘特页签会直接
    // 打不开(面板组件自己内部处理"没装包"的优雅降级,见 gantt-panel.tsx)。
    // 但"+"菜单/空状态启动器**不**用 PANEL_KINDS 本身——那两处改用下面的
    // `getAvailablePanelKinds()`,按 isDhtmlxAvailable() 把这一项过滤掉,
    // 装不到包时新建入口就不出现(与 AG-Grid Enterprise 那条缝同形:
    // main.tsx 在渲染 App 之前就把 dhtmlx 的可选加载探测完,所以这里读到的
    // isDhtmlxAvailable() 永远是"已经解析好的"那个值,不会有"未知"态被
    // 误当成"不可用"而把装了包的机器的页签也藏掉)。
    kind: 'gantt',
    label: 'panels.gantt.label',
    description: 'panels.gantt.desc',
    icon: <SquareGanttChart className="size-4" />,
    defaultTitle: 'panels.gantt.label',
    createState: () => ({ view: 'resource' }),
    Component: GanttPanelEntry,
  },
  {
    kind: 'web',
    label: 'panels.web.label',
    description: 'panels.web.desc',
    icon: <Globe className="size-4" />,
    defaultTitle: 'panels.web.label',
    createState: () => ({ url: '' }),
    Component: WebPanel,
  },
  {
    kind: 'rag',
    label: 'panels.rag.label',
    description: 'panels.rag.desc',
    icon: <BookOpen className="size-4" />,
    defaultTitle: 'panels.rag.label',
    Component: RagPanelEntry,
  },
  {
    kind: 'workflow',
    label: 'panels.workflow.label',
    description: 'panels.workflow.desc',
    icon: <Workflow className="size-4" />,
    defaultTitle: 'panels.workflow.label',
    createState: () => ({ workflowId: undefined }),
    Component: WorkflowPanelEntry,
  },
  {
    kind: 'doc',
    label: 'panels.doc.label',
    description: 'panels.doc.desc',
    icon: <FileText className="size-4" />,
    defaultTitle: 'panels.doc.label',
    // 打开时还不知道是哪份文件 —— 由「在右侧打开」把 projectId/name 填进来。
    createState: () => ({ projectId: undefined, name: undefined }),
    Component: DocPanel,
  },
  {
    // 图表面板不进「+」菜单:它没有"空着新建"的用法 —— 内容只能来自对话里
    // 已经生成的那张图(点图上的「在右侧打开」)。放进菜单等于给一个点开
    // 永远是空的格子。
    kind: 'widget',
    label: 'panels.widget.label',
    description: 'panels.widget.desc',
    icon: <BarChart3 className="size-4" />,
    defaultTitle: 'panels.widget.label',
    createState: () => ({ threadId: undefined, resourceUri: undefined, part: undefined }),
    Component: WidgetPanel,
  },
  {
    kind: '3d',
    label: 'panels.3d.label',
    description: 'panels.3d.desc',
    icon: <Box className="size-4" />,
    defaultTitle: 'panels.3d.label',
    Component: Viewer3dPanelEntry,
  },
];

const PANEL_KIND_MAP: Record<PanelKind, PanelKindDef> = PANEL_KINDS.reduce(
  (acc, def) => {
    acc[def.kind] = def;
    return acc;
  },
  {} as Record<PanelKind, PanelKindDef>,
);

export function getPanelKindDef(kind: PanelKind): PanelKindDef | undefined {
  return PANEL_KIND_MAP[kind];
}

/**
 * `PANEL_KINDS` filtered down to what's actually launchable **right now** —
 * for the "+" menu / empty-state launcher only. `PANEL_KINDS` itself (and
 * `getPanelKindDef`) stay unfiltered on purpose: a persisted tab of a kind
 * that's since become unavailable must still resolve to its component so it
 * can render its own graceful "not available" content, instead of the tab
 * silently losing its definition.
 *
 * Evaluated fresh on every call (not memoized at module scope) because
 * `isDhtmlxAvailable()` starts undetermined and only becomes deterministic
 * once `loadDhtmlxGantt()` settles. That's safe here specifically because
 * main.tsx's `StartupGate` awaits the dhtmlx probe (alongside the AG-Grid
 * Enterprise one) before `<App/>` — and therefore this component tree —
 * ever mounts. Call this from render bodies (not module scope), same as
 * `isAgGridEnterpriseReady()` is only read from render bodies.
 */
export function getAvailablePanelKinds(): PanelKindDef[] {
  return PANEL_KINDS.filter((def) => def.kind !== 'gantt' || isDhtmlxAvailable());
}
