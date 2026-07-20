/** Cross-app thread and message contracts (server sync + web display). */

import type { ThreadGoalState, ThreadLoopState } from './goal-loop';

export type UiMessage = {
  id?: string;
  role: string;
  content?: string;
  parts?: unknown[];
  metadata?: unknown;
};

export interface ThreadIdentity {
  threadId: string;
  tenantId: string;
  resourceId: string;
}

/** Persisted thread snapshot for restore / sync. */
export interface ThreadSnapshot {
  messages: UiMessage[];
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  }>;
  planMode: boolean;
  activatedSkills: Record<string, string>;
  pinnedSkills?: string[];
  workingMemory: string | null;
  goal?: ThreadGoalState | null;
  loop?: ThreadLoopState | null;
}
