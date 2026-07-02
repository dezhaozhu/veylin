/**
 * Unit tests for buildViewer3dTools — the viewer3d_* agent tools that let the model
 * drive the right-panel 3D viewer (show model / show overlay) and read back the
 * user's current face selection.
 *
 * execute() is called as (input, context) per @mastra/core's createTool typing
 * (see table-tools.test.ts for the sibling pattern this mirrors) — not the
 * `{ context: input }` shape used by older Mastra examples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewer3dTools } from './viewer3d-tools.js';
import { getViewer3dState } from './viewer3d-store.js';

test('show_model → store 更新且清空旧态; get_selection 读回', async () => {
  const tools = buildViewer3dTools();

  const showModelOut = await tools.viewer3d_show_model.execute!(
    { mesh_url: 'http://h/m.glb', title: 'T' },
    {} as never,
  );
  assert.deepEqual(showModelOut, { ok: true });
  assert.equal(getViewer3dState().model?.meshUrl, 'http://h/m.glb');
  assert.equal(getViewer3dState().model?.title, 'T');

  const showOverlayOut = await tools.viewer3d_show_overlay.execute!(
    { overlay_url: 'http://h/o.json' },
    {} as never,
  );
  assert.deepEqual(showOverlayOut, { ok: true });
  assert.equal(getViewer3dState().overlayUrl, 'http://h/o.json');

  const sel = await tools.viewer3d_get_selection.execute!({}, {} as never);
  assert.deepEqual(sel, { face_ids: [], updated_at: null });
});

test('show_overlay(null) 清除云图', async () => {
  const tools = buildViewer3dTools();
  await tools.viewer3d_show_model.execute!({ mesh_url: 'http://h/m2.glb' }, {} as never);
  await tools.viewer3d_show_overlay.execute!({ overlay_url: 'http://h/o2.json' }, {} as never);
  assert.equal(getViewer3dState().overlayUrl, 'http://h/o2.json');

  const out = await tools.viewer3d_show_overlay.execute!({ overlay_url: null }, {} as never);
  assert.deepEqual(out, { ok: true });
  assert.equal(getViewer3dState().overlayUrl, null);
});

test('get_selection 读回用户已点选的面', async () => {
  const { setViewer3dSelection } = await import('./viewer3d-store.js');
  const tools = buildViewer3dTools();
  await tools.viewer3d_show_model.execute!({ mesh_url: 'http://h/m3.glb' }, {} as never);
  setViewer3dSelection([3, 7]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sel = await (tools.viewer3d_get_selection.execute as any)({}, {} as never);
  assert.deepEqual(sel.face_ids, [3, 7]);
  assert.ok(typeof sel.updated_at === 'string');
});
