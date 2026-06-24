import { makeAssistantDataUI } from '@assistant-ui/react';
import { ArrowRightIcon } from 'lucide-react';

interface StepResult {
  agentId?: string;
  name?: string;
  text?: string;
  status?: string;
  [k: string]: unknown;
}

function stepSummary(step: StepResult): string {
  if (typeof step.text === 'string' && step.text.length > 0) {
    return step.text.slice(0, 120) + (step.text.length > 120 ? '…' : '');
  }
  return step.status ?? 'completed';
}

/** Inline card for a subagent (`task`) result written back into the thread. */
function AgentStepCard({ data }: { data: StepResult }) {
  const label = data.agentId ?? data.name ?? 'agent';
  return (
    <div className="border-border/40 bg-muted/20 my-1 flex items-start gap-1.5 rounded border px-2 py-1 text-xs">
      <ArrowRightIcon className="text-primary mt-0.5 size-3 shrink-0" />
      <span>
        <span className="font-medium">[subagent:{label}]</span>
        {data.text && <span className="text-muted-foreground ml-1">{stepSummary(data)}</span>}
      </span>
    </div>
  );
}

export const AgentStepDataUI = makeAssistantDataUI<StepResult>({
  name: 'tool-agent',
  render: AgentStepCard,
});

export function HandoffRenderers() {
  return (
    <>
      <AgentStepDataUI />
    </>
  );
}
