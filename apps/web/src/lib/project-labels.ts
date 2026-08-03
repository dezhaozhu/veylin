/**
 * Client-side display labels for projects.
 *
 * Source (scene) labels live in `@veylin/shared` (`PROJECT_SOURCE_LABELS`) —
 * the server needs them to name reconciler-created default projects; re-exported
 * here so web code keeps a single import site.
 *
 * The map below is the LEGACY per-entry overlay (v1 identity = MCP entry name).
 * It stays web-side purely as a display fallback for pre-migration values that
 * still hold old entry names (e.g. `moved_from`, unmigrated caches).
 */
export { PROJECT_SOURCE_LABELS, projectSourceLabel } from '@veylin/shared';

const PROJECT_LABELS: Record<string, string> = {
  'compass-guolu': '锅炉厂',
  'compass-shangzhong': '上重',
  'compass-对比': '对比分析',
};

export function projectLabel(serverName: string): string {
  return PROJECT_LABELS[serverName] ?? serverName;
}
