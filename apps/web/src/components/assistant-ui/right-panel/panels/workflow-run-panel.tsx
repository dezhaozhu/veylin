import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { WorkflowJsonBlock } from './workflow-json-block';
import {
  formatWorkflowValue,
  nodeDisplayLabel,
  nextPendingNodeId,
  primaryTextOutput,
  type RunLogEntry,
  type WorkflowRunView,
} from './workflow-run-utils';

type RunTab = 'result' | 'tracing' | 'variables';

export function WorkflowRunPanel({
  runs,
  selectedRunId,
  onSelectRun,
  selectedLogNodeId,
  onSelectLogNode,
  nodeLabels,
}: {
  runs: WorkflowRunView[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  selectedLogNodeId: string | null;
  onSelectLogNode: (nodeId: string | null) => void;
  nodeLabels: Map<string, string>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RunTab>('result');

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const selectedEntry = useMemo(() => {
    if (!selectedRun || !selectedLogNodeId) return null;
    return selectedRun.log.find((e) => e.nodeId === selectedLogNodeId) ?? null;
  }, [selectedRun, selectedLogNodeId]);

  const resultText = selectedRun ? primaryTextOutput(selectedRun.finalOutput) : null;

  if (runs.length === 0) {
    return (
      <div className="border-border text-muted-foreground border-t p-3 text-xs">
        {t('wf.noRuns')}
      </div>
    );
  }

  return (
    <div className="border-border flex min-h-44 max-h-[42%] shrink-0 border-t">
      <div className="border-border w-44 shrink-0 overflow-y-auto border-r p-1.5">
        <div className="text-muted-foreground mb-1 px-1 text-[10px] font-medium uppercase">
          {t('wf.run.history')}
        </div>
        {runs.map((run) => {
          const active = selectedRun?.id === run.id;
          return (
            <button
              key={run.id}
              type="button"
              className={cn(
                'mb-0.5 w-full rounded px-2 py-1.5 text-left text-[11px]',
                active ? 'bg-muted font-medium' : 'hover:bg-muted/60',
              )}
              onClick={() => {
                onSelectRun(run.id);
                onSelectLogNode(null);
                setTab('result');
              }}
            >
              <span
                className={
                  run.status === 'done'
                    ? 'text-green-600'
                    : run.status === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
              >
                {t(`wf.run.status.${run.status}`, { defaultValue: run.status })}
              </span>
              <div className="text-muted-foreground truncate">
                {new Date(run.startedAt).toLocaleString()}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1">
          {(['result', 'tracing', 'variables'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={cn(
                'rounded px-2 py-0.5 text-[11px]',
                tab === id ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50',
              )}
              onClick={() => setTab(id)}
            >
              {t(`wf.run.tab.${id}`)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
          {!selectedRun ? (
            <p className="text-muted-foreground">{t('wf.run.selectRun')}</p>
          ) : tab === 'result' ? (
            <ResultTab run={selectedRun} resultText={resultText} nodeLabels={nodeLabels} />
          ) : tab === 'tracing' ? (
            <TracingTab
              run={selectedRun}
              nodeLabels={nodeLabels}
              selectedLogNodeId={selectedLogNodeId}
              onSelectLogNode={onSelectLogNode}
              selectedEntry={selectedEntry}
            />
          ) : (
            <VariablesTab run={selectedRun} nodeLabels={nodeLabels} onSelectLogNode={onSelectLogNode} />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultTab({
  run,
  resultText,
  nodeLabels,
}: {
  run: WorkflowRunView;
  resultText: string | null;
  nodeLabels: Map<string, string>;
}) {
  const { t } = useTranslation();

  if (run.status === 'failed') {
    const err = [...run.log].reverse().find((e) => e.status === 'error');
    return (
      <div>
        <p className="text-destructive mb-2 font-medium">{t('wf.run.failed')}</p>
        {err ? (
          <p className="text-muted-foreground mb-2 text-[11px]">
            {nodeDisplayLabel(err.nodeId)} · {err.message}
          </p>
        ) : null}
        {err?.output !== undefined ? <WorkflowJsonBlock value={err.output} maxHeight="max-h-36" /> : null}
      </div>
    );
  }

  if (run.status === 'running' || run.status === 'queued') {
    const nodeIds = [...nodeLabels.keys()];
    const pendingId = nextPendingNodeId(run, nodeIds);
    const step = pendingId
      ? nodeDisplayLabel(pendingId, nodeLabels.get(pendingId))
      : run.log.at(-1)
        ? nodeDisplayLabel(run.log.at(-1)!.nodeId, nodeLabels.get(run.log.at(-1)!.nodeId))
        : null;
    const line = step ? t('wf.run.inProgressStep', { step }) : t('wf.run.inProgress');
    return <p className="text-muted-foreground">{line}</p>;
  }

  if (resultText) {
    return (
      <div>
        <p className="text-muted-foreground mb-1 text-[10px]">{t('wf.run.finalText')}</p>
        <div className="bg-muted/50 max-h-40 overflow-auto rounded border p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
          {resultText}
        </div>
        {run.finalOutput !== undefined && formatWorkflowValue(run.finalOutput) !== resultText ? (
          <details className="mt-2">
            <summary className="text-muted-foreground cursor-pointer text-[10px]">
              {t('wf.run.rawJson')}
            </summary>
            <WorkflowJsonBlock value={run.finalOutput} className="mt-1" maxHeight="max-h-32" />
          </details>
        ) : null}
      </div>
    );
  }

  if (run.finalOutput !== undefined) {
    return (
      <div>
        <p className="text-muted-foreground mb-1 text-[10px]">{t('wf.run.finalOutput')}</p>
        <WorkflowJsonBlock value={run.finalOutput} maxHeight="max-h-48" />
      </div>
    );
  }

  return <p className="text-muted-foreground">{t('wf.run.noFinalOutput')}</p>;
}

function TracingTab({
  run,
  nodeLabels,
  selectedLogNodeId,
  onSelectLogNode,
  selectedEntry,
}: {
  run: WorkflowRunView;
  nodeLabels: Map<string, string>;
  selectedLogNodeId: string | null;
  onSelectLogNode: (nodeId: string | null) => void;
  selectedEntry: RunLogEntry | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 gap-2">
      <ul className="w-[42%] shrink-0 space-y-0.5 overflow-y-auto pr-1">
        {(run.log ?? []).map((entry, i) => {
          const active = entry.nodeId === selectedLogNodeId;
          const label = nodeLabels.get(entry.nodeId) ?? entry.nodeId;
          return (
            <li key={`${run.id}-${i}`}>
              <button
                type="button"
                className={cn(
                  'w-full rounded px-1.5 py-1 text-left text-[11px]',
                  active ? 'bg-muted' : 'hover:bg-muted/50',
                )}
                onClick={() => onSelectLogNode(entry.nodeId)}
              >
                <span
                  className={
                    entry.status === 'ok'
                      ? 'text-green-600'
                      : entry.status === 'error'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }
                >
                  [{entry.status}]
                </span>{' '}
                <span className="font-medium">{nodeDisplayLabel(entry.nodeId, label)}</span>
                <span className="text-muted-foreground"> · {entry.kind}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selectedEntry ? (
          <>
            <p className="mb-1 font-medium">
              {nodeDisplayLabel(selectedEntry.nodeId, nodeLabels.get(selectedEntry.nodeId))}
            </p>
            <p className="text-muted-foreground mb-2 text-[10px]">{selectedEntry.message}</p>
            <p className="text-muted-foreground mb-0.5 text-[10px]">{t('wf.run.nodeOutput')}</p>
            <WorkflowJsonBlock value={selectedEntry.output} maxHeight="max-h-40" />
          </>
        ) : (
          <p className="text-muted-foreground text-[11px]">{t('wf.run.pickStep')}</p>
        )}
      </div>
    </div>
  );
}

function VariablesTab({
  run,
  nodeLabels,
  onSelectLogNode,
}: {
  run: WorkflowRunView;
  nodeLabels: Map<string, string>;
  onSelectLogNode: (nodeId: string | null) => void;
}) {
  const { t } = useTranslation();
  const entries = (run.log ?? []).filter((e) => e.status === 'ok' && e.output !== undefined);

  if (entries.length === 0) {
    return <p className="text-muted-foreground">{t('wf.run.noVariables')}</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <details key={entry.nodeId} className="border-border rounded border">
          <summary
            className="cursor-pointer px-2 py-1.5 text-[11px] font-medium"
            onClick={() => onSelectLogNode(entry.nodeId)}
          >
            {nodeDisplayLabel(entry.nodeId, nodeLabels.get(entry.nodeId))}
            <span className="text-muted-foreground font-normal"> · {entry.kind}</span>
          </summary>
          <div className="border-border border-t p-1.5">
            <WorkflowJsonBlock value={entry.output} maxHeight="max-h-28" />
          </div>
        </details>
      ))}
    </div>
  );
}
