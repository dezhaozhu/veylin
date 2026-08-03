import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getViewer3dState, setViewer3dModel, setViewer3dOverlay } from './viewer3d-store.js';

/**
 * Agent-facing tools for the right-panel 3D viewer. These only push/pull URLs and
 * face-id selections through viewer3d-store — the tools have no CAD knowledge
 * themselves (mesh_url/overlay_url come from the external caliper MCP server's
 * import_model / get_study_results tools; see plan Global Constraints).
 */
export function buildViewer3dTools() {
  const viewer3dShowModel = createTool({
    id: 'viewer3d_show_model',
    description:
      '在右侧 3D 面板显示模型。mesh_url 来自 caliper import_model 的 meshUrl。会清空既有云图与选择。',
    inputSchema: z.object({
      mesh_url: z.string().url(),
      title: z.string().optional(),
      model_id: z.string().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
    }),
    execute: async (input) => {
      setViewer3dModel({
        meshUrl: input.mesh_url,
        title: input.title,
        modelId: input.model_id,
      });
      return { ok: true };
    },
  });

  const viewer3dShowOverlay = createTool({
    id: 'viewer3d_show_overlay',
    description:
      '在 3D 面板叠加/清除结果云图。overlay_url 来自 get_study_results 的 overlayUrl,传 null 清除。',
    inputSchema: z.object({
      overlay_url: z.string().url().nullable(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
    }),
    execute: async (input) => {
      setViewer3dOverlay(input.overlay_url);
      return { ok: true };
    },
  });

  const viewer3dGetSelection = createTool({
    id: 'viewer3d_get_selection',
    description:
      '读取用户当前在 3D 面板选中的面(被动读取;若需要用户现在去点选,用 request_3d_selection)。',
    inputSchema: z.object({}),
    outputSchema: z.object({
      face_ids: z.array(z.number()),
      updated_at: z.string().nullable(),
    }),
    execute: async () => {
      const { selection } = getViewer3dState();
      return {
        face_ids: selection?.faceIds ?? [],
        updated_at: selection?.updatedAt ?? null,
      };
    },
  });

  return {
    viewer3d_show_model: viewer3dShowModel,
    viewer3d_show_overlay: viewer3dShowOverlay,
    viewer3d_get_selection: viewer3dGetSelection,
  };
}
