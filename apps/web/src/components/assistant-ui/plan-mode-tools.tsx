import { makeAssistantToolUI } from '@assistant-ui/react';

/** Plan mode transitions are reflected in the composer chip — hide generic tool rows. */
export const EnterPlanModeToolUI = makeAssistantToolUI<{ reason?: string }, { planMode: true }>({
  toolName: 'enter_plan_mode',
  display: 'standalone',
  render: () => null,
});

export const ExitPlanModeToolUI = makeAssistantToolUI<Record<string, never>, { planMode: false }>({
  toolName: 'exit_plan_mode',
  display: 'standalone',
  render: () => null,
});
