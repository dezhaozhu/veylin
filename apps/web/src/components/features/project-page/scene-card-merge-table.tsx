import { useMemo, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { projectSourceLabel } from '@/lib/project-labels';
import {
  buildMergedRows,
  partitionSectionRows,
  type MergedCell,
  type MergedRow,
  type RowDiff,
  type SceneDisplay,
  type SceneNarrative,
} from './scene-card-merge';
import { useOpenCorrection } from './use-open-correction';

/**
 * 对比合并视图 — the multi-scene 项目首页 view: one table, rows = the union of
 * the cards' `display` keys, columns = the scenes.
 *
 * Everything rendered here comes from the contract (`section` / `label` /
 * `value` / `num`); this component knows nothing about what any key means.
 * Difference emphasis is a single-hue wash of the existing `--color-primary`
 * token (no new palette, no legend) — a hint on top of values that are all
 * visible anyway, never the information itself.
 *
 * Rows only SOME scenes have are collapsed into a per-section disclosure
 * (see `partitionSectionRows` for the measurement that motivated it): the
 * comparison stays the table's subject, the rest is one click away.
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

const Cell: FC<{
  cell: MergedCell;
  diff: RowDiff;
  index: number;
  /** Only a cell WITH a value gets one — a "—" has nothing to report. */
  onReport?: () => void;
}> = ({ cell, diff, index, onReport }) => {
  const { t } = useTranslation();
  return (
    <td
      className="border-border/60 group/cell border-t px-2 py-1.5 align-top tabular-nums"
      style={cellStyle(diff, index)}
    >
      {/* An absent row for this scene is a fact of its own, so it is stated. */}
      {cell === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="flex items-baseline gap-1.5">
          <span>{cell.value}</span>
          {onReport ? (
            // Hover-revealed, same idiom as the sidebar's row actions
            // (settings-list.tsx): opacity-0 → group-hover, plus
            // focus-visible so it stays keyboard-reachable. A "—" cell has
            // nothing to report, so it gets nothing.
            //
            // No user-activation gate here: that gate exists in
            // McpAppActionBridge because a WIDGET can post a message with no
            // gesture behind it. A direct DOM click is user activation by
            // construction, and the payload is host-composed, not received.
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground shrink-0 text-[10px] whitespace-nowrap opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100"
              onClick={onReport}
            >
              {t('projectPage.reportWrong')}
            </button>
          ) : null}
        </span>
      )}
    </td>
  );
};

const Row: FC<{
  row: MergedRow;
  onReport: (row: MergedRow, index: number, value: string) => void;
}> = ({ row, onReport }) => (
  <tr>
    <th
      scope="row"
      className="border-border/60 text-muted-foreground border-t px-2 py-1.5 text-left font-normal"
    >
      {/* Non-numeric rows can only be "same" or "not the same" — the marker
          says which, the values say what. */}
      {row.diff.kind === 'differs' ? (
        <span className="bg-primary/40 mr-1.5 inline-block size-1 rounded-full align-middle" />
      ) : null}
      {row.label}
    </th>
    {row.cells.map((cell, i) => (
      <Cell
        key={`${row.key}-${i}`}
        cell={cell}
        diff={row.diff}
        index={i}
        onReport={cell === null ? undefined : () => onReport(row, i, cell.value)}
      />
    ))}
  </tr>
);

export const SceneCardMergeTable: FC<{
  scenes: readonly SceneDisplay[];
  /** Column sub-labels — only supplied when >1 capability server answers, so a
   * scene's two columns stay distinguishable. */
  serverLabels?: readonly (string | undefined)[];
  narratives: readonly SceneNarrative[];
  /** The page's CURRENT project — the 修正桥's only possible target (host
   * context; no cell ever names a project). */
  projectId: string;
}> = ({ scenes, serverLabels, narratives, projectId }) => {
  const { t } = useTranslation();
  const sections = useMemo(() => buildMergedRows(scenes), [scenes]);
  const openCorrection = useOpenCorrection(projectId);
  // Which sections have their partial rows expanded (see the toggle row below).
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set());
  const togglePartial = (section: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (!next.delete(section)) next.add(section);
      return next;
    });

  const colSpan = scenes.length + 1;

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
          {sections.map((section) => {
            const { shared, partial } = partitionSectionRows(section.rows);
            // 修正桥, host-composed: the row's own section/label/value and the
            // clicked COLUMN's source. Nothing here comes from a message —
            // same invariant as the widget path, reached without the widget.
            const report = (row: MergedRow, index: number, value: string) => {
              const source = scenes[index]?.source ?? '';
              openCorrection(source, {
                scene: source,
                section: section.section,
                label: row.label,
                current: value,
              });
            };
            return (
              <tbody key={section.section}>
                <tr>
                  <th
                    colSpan={colSpan}
                    className="text-muted-foreground px-2 pt-4 pb-1 text-left text-xs font-medium"
                  >
                    {section.section}
                  </th>
                </tr>
                {shared.map((row) => (
                  <Row key={row.key} row={row} onReport={report} />
                ))}
                {partial.length > 0 ? (
                  <>
                    {/* ONE table, not a nested one: a nested <table> lays its
                        columns out independently, and a browser measurement on
                        the real 对比 project put its last column 151px off the
                        outer header — in a comparison table a value drifting
                        under the wrong scene column is a correctness problem,
                        not a cosmetic one. So the disclosure is a toggle ROW
                        and the partial rows stay in this table body, where
                        alignment is structural. */}
                    <tr>
                      <td colSpan={colSpan} className="px-2 pt-1">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground cursor-pointer text-xs"
                          aria-expanded={openSections.has(section.section)}
                          onClick={() => togglePartial(section.section)}
                        >
                          {t('projectPage.partialRows', { count: partial.length })}
                        </button>
                      </td>
                    </tr>
                    {openSections.has(section.section)
                      ? partial.map((row) => <Row key={row.key} row={row} onReport={report} />)
                      : null}
                  </>
                ) : null}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
};
