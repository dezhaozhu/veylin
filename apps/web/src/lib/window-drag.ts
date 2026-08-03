import type { MouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@/lib/tauri-web-view';

const NO_DRAG_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[data-no-window-drag]',
].join(',');

export function startWindowDrag(event: MouseEvent<HTMLElement>): void {
  if (!isTauri() || event.button !== 0 || event.detail !== 1) return;
  if ((event.target as HTMLElement | null)?.closest(NO_DRAG_SELECTOR)) return;

  void getCurrentWindow().startDragging().catch(() => undefined);
}
