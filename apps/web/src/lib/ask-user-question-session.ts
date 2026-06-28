export type AskOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type AskQuestion = {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect?: boolean;
};

export type AskUserResult = {
  questions: AskQuestion[];
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
};

export type AskUserSession = {
  threadId: string;
  toolCallId: string;
  questions: AskQuestion[];
  addResult: (result: AskUserResult) => void;
};

const sessions = new Map<string, AskUserSession>();
const listeners = new Set<() => void>();

export function setAskUserSession(next: AskUserSession | null): void {
  if (next) {
    sessions.set(next.threadId, next);
  }
  for (const listener of listeners) listener();
}

export function getAskUserSession(): AskUserSession | null {
  return sessions.values().next().value ?? null;
}

export function hasAskUserSession(): boolean {
  return sessions.size > 0;
}

export function getAskUserSessionForThread(threadId: string | undefined): AskUserSession | null {
  if (!threadId) return null;
  return sessions.get(threadId) ?? null;
}

export function clearAskUserSession(threadId: string, toolCallId?: string): void {
  const current = sessions.get(threadId);
  if (!current) return;
  if (toolCallId && current.toolCallId !== toolCallId) return;
  sessions.delete(threadId);
  for (const listener of listeners) listener();
}

export function subscribeAskUserSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { hasAskUserAnswers } from './frontend-suspend-tools';
