const SELECTABLE_SELECTOR =
  '[data-slot="aui_assistant-message-content"], [data-slot="aui_user-message-content"]';

export type SelectionToolbarAnchor = {
  text: string;
  top: number;
  left: number;
};

export function findThreadSelectableRoot(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el) {
    if (el.matches(SELECTABLE_SELECTOR)) return el;
    if (el.matches('[data-slot="aui_thread-viewport"]')) return null;
    el = el.parentElement;
  }
  return null;
}

export function readThreadTextSelection(
  viewport: HTMLElement,
): SelectionToolbarAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString().replace(/\u00a0/g, ' ').trim();
  if (text.length < 2) return null;

  const range = selection.getRangeAt(0);
  if (!viewport.contains(range.commonAncestorContainer)) return null;
  if (!findThreadSelectableRoot(range.commonAncestorContainer)) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    text,
    top: rect.top,
    left: rect.left + rect.width / 2,
  };
}

export function formatSelectionAskComposerText(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || index === 0 || all[index - 1]?.length);
  const quote = lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
  return `${quote}\n\n`;
}

export function previewQuotedText(text: string, max = 72): string {
  const one = text.replace(/\s+/g, ' ').trim();
  const chars = [...one];
  if (chars.length <= max) return one;
  return `${chars.slice(0, max).join('')}…`;
}

/** Leading `> …` block from a sent user message (old inline quotes + new send prefix). */
export function splitQuotedPrefix(text: string): { quote: string | null; body: string } {
  const lines = text.split('\n');
  const quoted: string[] = [];
  let i = 0;
  while (i < lines.length && /^>/.test(lines[i])) {
    quoted.push(lines[i].replace(/^>\s?/, ''));
    i += 1;
  }
  if (quoted.length === 0) return { quote: null, body: text };
  while (i < lines.length && lines[i].trim() === '') i += 1;
  return { quote: quoted.join('\n').trim() || null, body: lines.slice(i).join('\n') };
}

function mergeQuotedDraft(body: string, quote: string): string {
  const quoted = quote.trim();
  const typed = body.trim();
  // Quote-only send: the chip itself is the message, not a `>` wrapper with no ask.
  if (!typed || typed === quoted) return quoted;
  return `${formatSelectionAskComposerText(quote)}${body}`;
}

export function applyQuotePrefixToMessage<T extends { content?: unknown; parts?: unknown[] }>(
  message: T,
  quote: string,
): T {
  if (!quote.trim()) return message;

  if (typeof message.content === 'string') {
    return {
      ...message,
      content: mergeQuotedDraft(message.content, quote),
    };
  }

  if (!Array.isArray(message.parts)) {
    return { ...message, parts: [{ type: 'text', text: mergeQuotedDraft('', quote) }] };
  }

  const parts = [...message.parts];
  const idx = parts.findIndex(
    (part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text',
  );
  if (idx < 0) {
    parts.unshift({ type: 'text', text: mergeQuotedDraft('', quote) });
    return { ...message, parts };
  }
  const part = parts[idx] as { type: string; text?: string };
  const body = typeof part.text === 'string' ? part.text : '';
  parts[idx] = {
    ...part,
    text: mergeQuotedDraft(body, quote),
  };
  return { ...message, parts };
}

export function clearThreadTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}
