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

export function clearThreadTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}
