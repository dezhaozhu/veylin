/**
 * Session-scoped in-memory store for the right-panel 3D viewer (CAD model + result
 * overlay + user face selection). Not persisted to SurrealDB — the 3D display state
 * only makes sense alongside a live caliper MCP server session, so it is fine for both
 * to reset together (YAGNI; see plan Global Constraints).
 */

import { EventEmitter } from 'node:events';

export interface Viewer3dModel {
  meshUrl: string;
  title?: string;
  modelId?: string;
}

export interface Viewer3dSelection {
  faceIds: number[];
  updatedAt: string;
}

export interface Viewer3dState {
  model: Viewer3dModel | null;
  overlayUrl: string | null;
  selection: Viewer3dSelection | null;
}

/** Viewer3d change events for live SSE sync (mirrors table-store.ts's TableEvent). */
export type Viewer3dEvent =
  | { type: 'modelReplace' }
  | { type: 'overlayUpdate' }
  | { type: 'selectionChange' };

const viewer3dEvents = new EventEmitter();
viewer3dEvents.setMaxListeners(0); // one listener per open SSE connection; no arbitrary cap

/** Subscribe to viewer3d change events (for the SSE endpoint). Returns an unsubscribe fn. */
export function onViewer3dEvent(cb: (event: Viewer3dEvent) => void): () => void {
  viewer3dEvents.on('change', cb);
  return () => {
    viewer3dEvents.off('change', cb);
  };
}

function emitViewer3d(event: Viewer3dEvent): void {
  viewer3dEvents.emit('change', event);
}

let state: Viewer3dState = {
  model: null,
  overlayUrl: null,
  selection: null,
};

export function getViewer3dState(): Viewer3dState {
  return {
    model: state.model ? { ...state.model } : null,
    overlayUrl: state.overlayUrl,
    selection: state.selection ? { ...state.selection, faceIds: [...state.selection.faceIds] } : null,
  };
}

/** Replace the displayed model. Clears any stale overlay/selection from the previous model. */
export function setViewer3dModel(model: Viewer3dModel): void {
  state = {
    model: { ...model },
    overlayUrl: null,
    selection: null,
  };
  emitViewer3d({ type: 'modelReplace' });
}

export function setViewer3dOverlay(overlayUrl: string | null): void {
  state = { ...state, overlayUrl };
  emitViewer3d({ type: 'overlayUpdate' });
}

export function setViewer3dSelection(faceIds: number[]): void {
  state = {
    ...state,
    selection: { faceIds: [...faceIds], updatedAt: new Date().toISOString() },
  };
  emitViewer3d({ type: 'selectionChange' });
}

/** Inject current viewer3d state so the model does not miss right-panel 3D selection/display state. */
export function buildViewer3dContextBlock(): string {
  const { model, overlayUrl, selection } = state;
  if (!model) return '';

  const modelLabel = model.title ?? model.meshUrl;
  const modelIdSuffix = model.modelId ? `(model_id: ${model.modelId})` : '';
  const selectionLabel = selection?.faceIds.length ? selection.faceIds.join(', ') : '无';

  return [
    '## 3D 面板当前状态',
    `- 模型: ${modelLabel}${modelIdSuffix}`,
    `- 云图: ${overlayUrl ? '已显示' : '未显示'}`,
    `- 用户当前选中的面: ${selectionLabel}`,
    '说明: 用户可能已在 3D 面板点选了面;selection 中的 faceId 可直接用于 create_study 的 fixed_face_ids/loads。',
  ].join('\n');
}
