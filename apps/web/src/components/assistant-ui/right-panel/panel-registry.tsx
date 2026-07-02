/**
 * Right-panel content registry.
 *
 * Tab responsibilities (do not overlap):
 * | Tab       | Role                                      | vs Automate                          |
 * |-----------|-------------------------------------------|--------------------------------------|
 * | Table     | Editable spreadsheet grid (table store)   | Automate = single-step cron/event    |
 * | Web       | Embedded browser for read_open_page       |   -> Agent prompt, separate storage  |
 * | Knowledge | RAG upload, search, citations + KG        | Workflow = multi-step executable DAG |
 * | Workflow  | Visual DAG editor + real execution engine | Both share InProcQueue / cron / hook |
 *
 * label/description/defaultTitle hold i18n keys, resolved with t() at render.
 */
import { BookOpen, Box, Globe, Table, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { TableGrid } from '@/components/assistant-ui/table-grid';
import { WebBrowserPanel } from '@/components/assistant-ui/right-panel/panels/web-browser-panel';
import { RagPanel } from '@/components/assistant-ui/right-panel/panels/rag-panel';
import { WorkflowPanel } from '@/components/assistant-ui/right-panel/panels/workflow-panel';
import { Viewer3dPanel } from '@/components/assistant-ui/right-panel/panels/viewer3d-panel';
import type { PanelContentProps, PanelKind, PanelKindDef } from './panel-types';

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

/** All registered panel kinds. Order drives the "+" menu. */
export const PANEL_KINDS: PanelKindDef[] = [
  {
    kind: 'table',
    label: 'panels.table.label',
    description: 'panels.table.desc',
    icon: <Table className="size-4" />,
    defaultTitle: 'panels.table.label',
    Component: TablePanel,
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
