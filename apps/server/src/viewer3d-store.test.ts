/**
 * Unit tests for the viewer3d-store change-event bus (backs the SSE live-sync endpoint).
 * The store is an in-memory singleton (session-scoped, no DB) — see table-store-events.test.ts
 * for the sibling pattern this mirrors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getViewer3dState, setViewer3dModel, setViewer3dOverlay,
  setViewer3dSelection, onViewer3dEvent, buildViewer3dContextBlock,
} from './viewer3d-store.js';

test('modelReplace 清空 overlay 与 selection 并发事件', () => {
  const events: string[] = [];
  const off = onViewer3dEvent((e) => events.push(e.type));
  setViewer3dOverlay('http://x/overlay.json');
  setViewer3dSelection([1, 2]);
  setViewer3dModel({ meshUrl: 'http://x/mesh.glb', title: '支架' });
  const s = getViewer3dState();
  assert.equal(s.overlayUrl, null);
  assert.equal(s.selection, null);
  assert.deepEqual(events, ['overlayUpdate', 'selectionChange', 'modelReplace']);
  off();
});

test('context block: 无模型空串; 有模型含选中面', () => {
  setViewer3dModel({ meshUrl: 'http://x/mesh.glb', title: '支架', modelId: 'm1' });
  setViewer3dSelection([3, 7]);
  const block = buildViewer3dContextBlock();
  assert.match(block, /支架/);
  assert.match(block, /m1/);
  assert.match(block, /3, 7/);
});
