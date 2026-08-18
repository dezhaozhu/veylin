import { getChatSettings } from '@/lib/chat-settings';
import { getPendingQuote } from '@/lib/pending-quote';

type ComposerApi = {
  getState: () => { canSend: boolean; isEmpty: boolean; text?: string };
  setText: (text: string) => void;
  send: (opts?: { startRun?: boolean }) => void;
};

/** Seed the textarea when only a quote/skill chip is present so AUI will accept send. */
export function seedComposerTextForSend(composerText: string, quote: string | null): string | null {
  if (composerText.trim()) return null;
  const quoted = quote?.trim();
  return quoted || null;
}

/** Send the current draft. Quote-only (no typed text) is sendable. */
export function sendComposerDraft(
  composer: ComposerApi,
  opts?: { startRun?: boolean; threadIds?: readonly string[] },
): boolean {
  const state = composer.getState();
  const quote = getPendingQuote(opts?.threadIds ?? [])?.trim() ?? null;
  const skill = getChatSettings().pendingSkill;
  const seed = seedComposerTextForSend(state.text ?? '', quote);

  if (state.canSend && !seed) {
    composer.send(opts);
    return true;
  }

  if (seed) {
    composer.setText(seed);
    composer.send(opts);
    return true;
  }

  if (state.isEmpty && skill) {
    composer.setText(' ');
    composer.send(opts);
    return true;
  }

  if (state.canSend) {
    composer.send(opts);
    return true;
  }

  return false;
}
