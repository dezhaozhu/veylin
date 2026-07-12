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
import { useAuiState } from '@assistant-ui/react';
import { BookOpen, Globe, Table, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { TableGrid } from '@/components/assistant-ui/table-grid';
import { WebBrowserPanel } from '@/components/assistant-ui/right-panel/panels/web-browser-panel';
import { RagPanel } from '@/components/assistant-ui/right-panel/panels/rag-panel';
import { WorkflowPanel } from '@/components/assistant-ui/right-panel/panels/workflow-panel';
import type { PanelContentProps, PanelKind, PanelKindDef } from './panel-types';

function TablePanel({ tab, updateState }: PanelContentProps) {
  const localId = useAuiState((s) => s.threadListItem.id);
  const remoteId = useAuiState(
    (s) => s.threadListItem.remoteId ?? s.threadListItem.externalId,
  );
  const threadId = remoteId ?? localId ?? null;
  const sheetId =
    typeof tab.state?.sheetId === 'string' && tab.state.sheetId.trim()
      ? tab.state.sheetId.trim()
      : null;
  return (
    <TableGrid
      key={`${threadId ?? 'no-thread'}:${tab.id}`}
      threadId={threadId}
      boundSheetId={sheetId}
      onBoundSheet={(id) => updateState({ sheetId: id })}
    />
  );
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
