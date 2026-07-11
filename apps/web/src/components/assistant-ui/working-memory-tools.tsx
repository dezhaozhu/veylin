import { makeAssistantToolUI } from '@assistant-ui/react';

/**
 * Mastra Memory injects working-memory tools when `workingMemory.enabled` is true
 * and memory is not `readOnly`. Veylin runs Memory with `readOnly: true` so the
 * main agent loop does not get these tools; writes use dream / syncWorkingMemory.
 * Keep these UIs as a belt-and-suspenders hide if a tool part still appears.
 */
export const UpdateWorkingMemoryToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: 'updateWorkingMemory',
  render: () => null,
});

export const SetWorkingMemoryToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: 'setWorkingMemory',
  render: () => null,
});
