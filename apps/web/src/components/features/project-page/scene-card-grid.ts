/**
 * Pure derivation logic for the 项目首页 cards grid.
 *
 * Grid shape: rows = the project's sources, columns = the capability servers
 * that expose a `get_scene_card` MCP-App tool, taken from
 * `GET /api/mcp-apps/tools?projectId=…`'s additive `byServer` map
 * (routes/mcp-apps.ts `collectMcpAppTools`). A server that declares no
 * `get_scene_card` simply contributes NO column — that is normal capability
 * absence, never an error. Density lives inside the widget itself (compass's
 * scene-card.html renders its own one-line sections + expanders); this module
 * only decides which cells exist.
 */

export const SCENE_CARD_TOOL = 'get_scene_card';

/** server → (toolName → ui:// resource uri), the `byServer` wire shape. */
export type McpAppToolsByServer = Record<string, Record<string, string>>;

export type SceneCardColumn = { server: string; resourceUri: string };

/**
 * Servers exposing `get_scene_card`, as grid columns (sorted for a stable
 * layout — mirrors the host route's deterministic server precedence).
 * Tolerates a missing/empty map (tools fetch failed ⇒ no columns, no error).
 */
export function sceneCardColumns(
  byServer: McpAppToolsByServer | null | undefined,
): SceneCardColumn[] {
  if (!byServer) return [];
  return Object.keys(byServer)
    .filter((server) => typeof byServer[server]?.[SCENE_CARD_TOOL] === 'string')
    .sort((a, b) => a.localeCompare(b))
    .map((server) => ({ server, resourceUri: byServer[server]![SCENE_CARD_TOOL]! }));
}

/**
 * `get_scene_card` arguments for one cell: name the scene only when the
 * project spans several sources; a single-source project omits it — its v2b
 * single-scene session dispatches without an explicit scene.
 */
export function sceneCardArgs(
  sources: readonly string[],
  source: string,
): Record<string, unknown> {
  return sources.length > 1 ? { scene: source } : {};
}
