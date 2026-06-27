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
  toolCallId: string;
  questions: AskQuestion[];
  addResult: (result: AskUserResult) => void;
};

let session: AskUserSession | null = null;
const listeners = new Set<() => void>();

export function setAskUserSession(next: AskUserSession | null): void {
  session = next;
  for (const listener of listeners) listener();
}

export function getAskUserSession(): AskUserSession | null {
  return session;
}

export function subscribeAskUserSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { hasAskUserAnswers } from './frontend-suspend-tools';
