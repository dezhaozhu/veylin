import { makeAssistantToolUI } from '@assistant-ui/react';

/**
 * Mastra Memory injects working-memory tools when `workingMemory.enabled` is true.
 * They are framework-internal (not part of Veylin's tool registry) and are also
 * updated server-side via `memory.updateWorkingMemory()`. Hide them from chat UI.
 */
export const UpdateWorkingMemoryToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: 'updateWorkingMemory',
  display: 'standalone',
  render: () => null,
});

export const SetWorkingMemoryToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: 'setWorkingMemory',
  display: 'standalone',
  render: () => null,
});
