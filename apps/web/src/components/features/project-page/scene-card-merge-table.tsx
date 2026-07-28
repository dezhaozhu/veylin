import { useMemo, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { projectSourceLabel } from '@/lib/project-labels';
import {
  buildMergedRows,
  type MergedCell,
  type RowDiff,
  type SceneDisplay,
  type SceneNarrative,
} from './scene-card-merge';

/**
 * 对比合并视图 — the multi-scene 项目首页 view: one table, rows = the union of
 * the cards' `display` keys, columns = the scenes.
 *
 * Everything rendered here comes from the contract (`section` / `label` /
 * `value` / `num`); this component knows nothing about what any key means.
 * Difference emphasis is a single-hue wash of the existing `--color-primary`
 * token (no new palette, no legend) — a hint on top of values that are all
 * visible anyway, never the information itself.
 */

/** Shading for one cell. Magnitude is sequential ⇒ ONE hue, weakest→strongest,
 * capped low (≤10%) so a dense table never becomes a heatmap. The row minimum
 * gets no wash at all, so "shaded" reads as "more than the others here". */
function cellStyle(diff: RowDiff, index: number): { backgroundColor: string } | undefined {
  if (diff.kind !== 'numeric') return undefined;
  const intensity = diff.intensity[index];
  if (intensity === null || intensity === undefined || intensity <= 0) return undefined;
  const pct = (intensity * 10).toFixed(1);
  return { backgroundColor: `color-mix(in oklab, var(--color-primary) ${pct}%, transparent)` };
}

const Cell: FC<{ cell: MergedCell; diff: RowDiff; index: number }> = ({ cell, diff, index }) => (
  <td
    className="border-border/60 border-t px-2 py-1.5 align-top tabular-nums"
    style={cellStyle(diff, index)}
  >
    {/* An absent row for this scene is a fact of its own, so it is stated. */}
    {cell === null ? <span className="text-muted-foreground">—</span> : cell.value}
  </td>
);

export const SceneCardMergeTable: FC<{
  scenes: readonly SceneDisplay[];
  /** Column sub-labels — only supplied when >1 capability server answers, so a
   * scene's two columns stay distinguishable. */
  serverLabels?: readonly (string | undefined)[];
  narratives: readonly SceneNarrative[];
}> = ({ scenes, serverLabels, narratives }) => {
  const { t } = useTranslation();
  const sections = useMemo(() => buildMergedRows(scenes), [scenes]);

  return (
    <div className="mb-8">
      {/* Narratives are per-scene prose — never merged into rows. Collapsed by
          default so the comparison stays the page's subject. */}
      {narratives.map((n) => (
        <details key={n.source} className="mb-1 text-sm">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
            {projectSourceLabel(n.source)} · {t('projectPage.narrative')}
          </summary>
          <p className="mt-1 mb-2 leading-relaxed">{n.text}</p>
        </details>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="w-1/4 px-2 py-1 text-left font-medium" />
              {scenes.map((scene, i) => (
                <th key={`${scene.source}-${i}`} className="px-2 py-1 text-left font-medium">
                  {projectSourceLabel(scene.source)}
                  {serverLabels?.[i] ? ` · ${serverLabels[i]}` : ''}
                </th>
              ))}
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.section}>
              <tr>
                <th
                  colSpan={scenes.length + 1}
                  className="text-muted-foreground px-2 pt-4 pb-1 text-left text-xs font-medium"
                >
                  {section.section}
                </th>
              </tr>
              {section.rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="border-border/60 text-muted-foreground border-t px-2 py-1.5 text-left font-normal"
                  >
                    {/* Non-numeric rows can only be "same" or "not the same" —
                        the marker says which, the values say what. */}
                    {row.diff.kind === 'differs' ? (
                      <span className="bg-primary/40 mr-1.5 inline-block size-1 rounded-full align-middle" />
                    ) : null}
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <Cell key={`${row.key}-${i}`} cell={cell} diff={row.diff} index={i} />
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
};
