/** Focus the composer textarea and place the caret after React/aui state updates. */
export function placeComposerCaret(cursor: number): void {
  const run = () => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector<HTMLTextAreaElement>('textarea.aui-composer-input');
    if (!el) return;
    el.focus();
    const pos = Math.min(Math.max(0, cursor), el.value.length);
    el.setSelectionRange(pos, pos);
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run));
  } else {
    queueMicrotask(run);
  }
}
