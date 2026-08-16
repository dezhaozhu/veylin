/**
 * Project = the first-class thread-pin target (v3): a named set of granted
 * Compass sources ("scene set"). Reconciler-managed default projects carry
 * `managed: true` (one per granted source); user-composed projects are
 * `managed: false`. Disabled projects are kept, never deleted — a pin to a
 * disabled project denies scoped access rather than leaking it.
 */
export interface Project {
  id: string;
  tenantId: string;
  name: string;
  /** Compass source (scene) codes, e.g. ['guolu'] or ['guolu', 'shangzhong']. */
  sources: string[];
  managed: boolean;
  enabled: boolean;
  /**
   * Structural identity marker (set once at creation, never patched): the
   * legacy entry name this project was materialized from by the boot
   * migration (e.g. 'compass-对比'). Identity checks match on this, never on
   * the display name — user-composed projects can share any name safely.
   */
  migratedFrom?: string;
  /**
   * 项目文件夹的绝对路径(用户选)。原件、产物、快照都躺在这里,`.veylin/` 放
   * 不可变原件仓与 manifest —— 见 docs/specs/2026-08-14-project-folder-immutable-originals.md。
   * 没设 = 这个项目还没绑文件夹(旧项目全是这样),导入照旧只存解析结果。
   */
  folder?: string;
  createdAt?: string;
}

/**
 * Human-readable labels for Compass *source* (scene) codes. Shared because the
 * server needs them too: the compass-identity reconciler names each default
 * project after its single source. Unknown sources fall back to the raw code —
 * extend this map to rename them. (The legacy per-entry map, keyed by MCP entry
 * names like `compass-guolu`, stays web-side in `apps/web/src/lib/project-labels.ts`
 * as a display fallback for pre-migration values.)
 */
export const PROJECT_SOURCE_LABELS: Record<string, string> = {
  guolu: '锅炉厂',
  shangzhong: '上重',
};

export function projectSourceLabel(source: string): string {
  // 个人工作区的 id 带一段防撞车的指纹(compass: me:<slug>-<sha8>),那是给机器看的。
  // 把它原样摆给用户,人只会看到一串不认识的东西 —— 而它其实就是"他自己的空间"。
  if (source.startsWith('me:')) return '我的工作区';
  return PROJECT_SOURCE_LABELS[source] ?? source;
}
