import { getActiveWebTabId } from '@/lib/panel-tabs-storage';
import { readWebView, truncatePageContent } from '@/lib/tauri-web-view';

export type ReadOpenPageResult = {
  mode?: 'text' | 'html';
  url?: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};

export type ReadOpenPageResultSubmitter = (
  toolCallId: string,
  result: ReadOpenPageResult,
  options?: { isError?: boolean },
) => void | Promise<void>;

const submittersByThread = new Map<string, ReadOpenPageResultSubmitter>();

/** toolCallId -> in-flight AbortController (Stop cancels these). */
const inflightByToolCallId = new Map<string, AbortController>();

/** toolCallIds already submitted (success or error) — avoid double read. */
const submittedToolCallIds = new Set<string>();

const submittedListeners = new Set<() => void>();
let submittedVersion = 0;

function bumpSubmitted(): void {
  submittedVersion += 1;
  for (const l of submittedListeners) l();
}

export function subscribeReadOpenPageSubmitted(listener: () => void): () => void {
  submittedListeners.add(listener);
  return () => submittedListeners.delete(listener);
}

export function getReadOpenPageSubmittedVersion(): number {
  return submittedVersion;
}

export function registerReadOpenPageResultSubmitter(
  threadId: string,
  fn: ReadOpenPageResultSubmitter | null,
): void {
  if (fn) {
    submittersByThread.set(threadId, fn);
  } else {
    submittersByThread.delete(threadId);
  }
}

export function isReadOpenPageSubmitted(toolCallId: string): boolean {
  return submittedToolCallIds.has(toolCallId);
}

export function markReadOpenPageSubmitted(toolCallId: string): void {
  submittedToolCallIds.add(toolCallId);
  bumpSubmitted();
}

export function clearReadOpenPageSubmitted(toolCallId?: string): void {
  if (toolCallId) {
    submittedToolCallIds.delete(toolCallId);
    bumpSubmitted();
    return;
  }
  submittedToolCallIds.clear();
  bumpSubmitted();
}

/** Abort all in-flight page reads (composer Stop). */
export function abortAllReadOpenPageReads(): void {
  for (const [id, ac] of inflightByToolCallId) {
    ac.abort();
    inflightByToolCallId.delete(id);
  }
}

export function abortReadOpenPageRead(toolCallId: string): void {
  const ac = inflightByToolCallId.get(toolCallId);
  if (ac) {
    ac.abort();
    inflightByToolCallId.delete(toolCallId);
  }
}

export async function submitReadOpenPageResult(
  threadId: string,
  toolCallId: string,
  result: ReadOpenPageResult,
  options?: { isError?: boolean },
): Promise<boolean> {
  markReadOpenPageSubmitted(toolCallId);
  const submitter = submittersByThread.get(threadId);
  if (!submitter) return false;
  await submitter(toolCallId, result, options);
  return true;
}

/**
 * Perform the desktop WebView read and submit via the registered bridge.
 * Safe to call from runtime even after chat.stop() killed ToolUI addResult.
 *
 * Tab resolution: explicit `tabId` → attached browser tab → active web tab.
 * Never silently falls back to a stale ActiveWebTab when none of these resolve.
 */
export async function executeReadOpenPageForToolCall(options: {
  threadId: string;
  toolCallId: string;
  mode?: 'text' | 'html';
  maxChars?: number;
  tabId?: string;
  attachedTabId?: string;
}): Promise<ReadOpenPageResult | null> {
  const { threadId, toolCallId } = options;
  if (submittedToolCallIds.has(toolCallId)) return null;
  if (inflightByToolCallId.has(toolCallId)) return null;

  const mode = options.mode ?? 'text';
  const maxChars = options.maxChars ?? 50_000;
  const ac = new AbortController();
  inflightByToolCallId.set(toolCallId, ac);

  try {
    if (ac.signal.aborted) {
      const interrupted: ReadOpenPageResult = { mode, error: 'Interrupted by user.' };
      await submitReadOpenPageResult(threadId, toolCallId, interrupted, { isError: true });
      return interrupted;
    }

    const resolvedTabId =
      options.tabId?.trim() ||
      options.attachedTabId?.trim() ||
      getActiveWebTabId() ||
      null;
    if (!resolvedTabId) {
      const result: ReadOpenPageResult = {
        mode,
        error:
          'No web tab to read. Open a page in the docked browser, focus a web tab, ' +
          'or pass tabId / @-attach a specific tab.',
      };
      await submitReadOpenPageResult(threadId, toolCallId, result, { isError: true });
      return result;
    }

    const page = await readWebView(mode, resolvedTabId);
    if (ac.signal.aborted) {
      const interrupted: ReadOpenPageResult = { mode, error: 'Interrupted by user.' };
      await submitReadOpenPageResult(threadId, toolCallId, interrupted, { isError: true });
      return interrupted;
    }

    const { content, truncated } = truncatePageContent(page.content, maxChars);
    const result: ReadOpenPageResult = {
      mode,
      url: page.url,
      title: page.title,
      content,
      truncated,
    };
    await submitReadOpenPageResult(threadId, toolCallId, result);
    return result;
  } catch (e) {
    if (ac.signal.aborted) {
      const interrupted: ReadOpenPageResult = { mode, error: 'Interrupted by user.' };
      await submitReadOpenPageResult(threadId, toolCallId, interrupted, { isError: true });
      return interrupted;
    }
    const result: ReadOpenPageResult = {
      mode,
      error: e instanceof Error ? e.message : String(e),
    };
    await submitReadOpenPageResult(threadId, toolCallId, result, { isError: true });
    return result;
  } finally {
    if (inflightByToolCallId.get(toolCallId) === ac) {
      inflightByToolCallId.delete(toolCallId);
    }
  }
}
