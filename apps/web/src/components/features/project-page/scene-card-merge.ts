/**
 * Pure derivation logic for the 对比合并视图 (scene-card v2 Phase 4).
 *
 * A capability server may attach a `display` array to its scene-card payload:
 * `[{key, section, label, value, num?, unit?, tone?}]` — a self-describing
 * projection of whatever the card contains. This module merges those rows from
 * several scenes into ONE comparison table.
 *
 * ZERO domain knowledge lives here: nothing below knows what a `key` means, and
 * no key is ever special-cased. Rows are unioned by key, grouped by the
 * `section` string the payload itself supplies, and compared with two generic
 * rules (numeric spread / string inequality). A server that ships different
 * keys next month merges just as well.
 *
 * Honest degradation: the merged table exists only when EVERY fetched card
 * carries a non-empty `display` (see `canMergeCards`). One card without it ⇒
 * the page falls back to today's side-by-side widget cells rather than showing
 * a partially-populated comparison.
 */

/**
 * One row of the `display` contract. Optional fields stay optional — a card
 * that omits `num` is simply not numerically comparable.
 *
 * `value` is AUTHORITATIVE for display and already carries its unit (e.g.
 * "2,646 吨/月"). `unit` and `num` are the machine-readable decomposition, for
 * consumers that COMPUTE — `num` drives this module's numeric diff shading,
 * `unit` is there for a future consumer that charts or re-formats. Neither is
 * rendered next to `value`; appending `unit` would print the unit twice, so
 * please don't "fix" its absence.
 */
export type DisplayRow = {
  key: string;
  section: string;
  label: string;
  value: string;
  num?: number;
  unit?: string;
  tone?: string;
};

/** A scene's contribution to the merge: its label-able source id + its rows. */
export type SceneDisplay = { source: string; rows: readonly DisplayRow[] };

/** A merged cell — null when this scene has no row for that key. A missing
 * cell is information (this scene lacks the fact), never a blank. */
export type MergedCell = { value: string; num?: number } | null;

/**
 * How a row differs across scenes, decided ONLY from the contract fields:
 * - `none` — fewer than two present cells, or every present cell is equal;
 * - `numeric` — every present cell carries `num` and they are not all equal;
 *   `intensity[i]` ∈ [0,1] is the min-max normalised position of that cell
 *   (1 = the row's max), null where the cell is missing;
 * - `differs` — the string values are not all equal (no numbers to scale by).
 */
export type RowDiff =
  | { kind: 'none' }
  | { kind: 'numeric'; intensity: (number | null)[] }
  | { kind: 'differs' };

export type MergedRow = {
  key: string;
  label: string;
  cells: MergedCell[];
  diff: RowDiff;
};

export type MergedSection = { section: string; rows: MergedRow[] };

/** A scene's narrative prose. Narratives are NEVER merged (they are per-scene
 * paragraphs, not comparable rows) — this only extracts them. */
export type SceneNarrative = { source: string; text: string; generatedAt?: string };

// ---------------------------------------------------------------------------
// payload extraction (tolerant, contract-only)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The card object inside whatever the host route returned. MCP tool results
 * reach us in one of three equally legitimate shapes, so all three are read
 * (in order) instead of hardcoding one client's envelope:
 *   1. `{structuredContent: card}` — the CallToolResult typed channel;
 *   2. `{content: [{type:'text', text: '<json>'}]}` — the text channel;
 *   3. the card object itself — hosts that already unwrap.
 * No envelope key is card-specific, so this stays domain-agnostic; a shape
 * that is not an object at all ⇒ null (⇒ no display ⇒ fallback, never a guess).
 */
export function readCardPayload(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  if (isRecord(result.structuredContent)) return result.structuredContent;
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (!isRecord(part) || typeof part.text !== 'string') continue;
      try {
        const parsed: unknown = JSON.parse(part.text);
        if (isRecord(parsed)) return parsed;
      } catch {
        /* not json — try the next part */
      }
    }
  }
  return result;
}

function isDisplayRow(v: unknown): v is DisplayRow {
  if (!isRecord(v)) return false;
  if (typeof v.key !== 'string' || v.key === '') return false;
  // `section` is rendered as a group header, so an empty/whitespace one would
  // print a blank heading above real rows — same posture as the non-empty key
  // requirement: a row that cannot say where it belongs is not a valid row.
  if (typeof v.section !== 'string' || v.section.trim() === '') return false;
  if (typeof v.label !== 'string') return false;
  if (typeof v.value !== 'string') return false;
  if (v.num !== undefined && !(typeof v.num === 'number' && Number.isFinite(v.num))) return false;
  return true;
}

/**
 * The card's display rows, or null when the card carries none (the fallback
 * signal). Malformed rows are dropped rather than rendered — a row that
 * doesn't satisfy the contract cannot be merged honestly. Duplicate keys keep
 * the first occurrence (one fact, one row).
 */
export function extractDisplayRows(result: unknown): DisplayRow[] | null {
  const payload = readCardPayload(result);
  if (!payload || !Array.isArray(payload.display)) return null;
  const seen = new Set<string>();
  const rows: DisplayRow[] = [];
  for (const raw of payload.display) {
    if (!isDisplayRow(raw) || seen.has(raw.key)) continue;
    seen.add(raw.key);
    rows.push(raw);
  }
  return rows.length > 0 ? rows : null;
}

/**
 * The card's narrative paragraph, if it actually has text. `{status:
 * "pending"}` / `{status: "unavailable"}` ⇒ null: the merged view shows
 * nothing rather than a placeholder (the per-scene widget owns those states).
 */
export function extractNarrative(source: string, result: unknown): SceneNarrative | null {
  const payload = readCardPayload(result);
  const narrative = payload?.narrative;
  if (!isRecord(narrative)) return null;
  const text = narrative.text;
  if (typeof text !== 'string' || text.trim() === '') return null;
  const generatedAt = narrative.generated_at;
  return {
    source,
    text,
    ...(typeof generatedAt === 'string' ? { generatedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

/** A fetched card as the page sees it: which scene it belongs to, and its
 * display rows — null when the card failed or carries no `display`. */
export type SceneCandidate = { source: string; rows: readonly DisplayRow[] | null };

/**
 * The merged table's precondition: the cards span MORE THAN ONE scene, and
 * every single one carries rows. `null` rows = a card that failed or has no
 * `display` — either way ⇒ side-by-side fallback. There is no partial merge: a
 * whole column of dashes would read as "this scene has no facts", a lie. And a
 * single-scene project has nothing to compare, so it keeps its widget card.
 */
export function canMergeCards(cards: readonly SceneCandidate[]): boolean {
  if (!cards.every((c) => c.rows !== null && c.rows.length > 0)) return false;
  return new Set(cards.map((c) => c.source)).size > 1;
}

// ---------------------------------------------------------------------------
// the merge
// ---------------------------------------------------------------------------

/**
 * Difference decision for one row's cells, in column order.
 * Generic by construction: numbers are compared as numbers when EVERY present
 * cell has one, otherwise the display strings are compared for equality. No
 * key, unit or section ever influences this.
 */
export function rowDiff(cells: readonly MergedCell[]): RowDiff {
  const present = cells.filter((c): c is NonNullable<MergedCell> => c !== null);
  if (present.length < 2) return { kind: 'none' };

  if (present.every((c) => typeof c.num === 'number')) {
    const nums = present.map((c) => c.num!);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    // Identical numbers (a zero spread) → nothing to shade.
    if (max === min) return { kind: 'none' };
    return {
      kind: 'numeric',
      intensity: cells.map((c) =>
        c === null || typeof c.num !== 'number' ? null : (c.num - min) / (max - min),
      ),
    };
  }

  const first = present[0]!.value;
  return present.every((c) => c.value === first) ? { kind: 'none' } : { kind: 'differs' };
}

/**
 * The comparison table: rows = the union of display keys, columns = the given
 * scenes in the given order.
 *
 * Key order = the first scene's row order, then keys introduced by later
 * scenes appended in the order they are first seen (a scene with an extra fact
 * never reorders the shared ones). Label/section for a key come from the first
 * scene that carries it. Rows are then grouped by `section`, sections ordered
 * by their first appearance in that key order — so grouping never invents an
 * ordering the payload didn't imply.
 */
export function buildMergedRows(scenes: readonly SceneDisplay[]): MergedSection[] {
  const order: string[] = [];
  const meta = new Map<string, { label: string; section: string }>();
  const byScene = scenes.map((scene) => {
    const map = new Map<string, DisplayRow>();
    for (const row of scene.rows) {
      if (!map.has(row.key)) map.set(row.key, row);
      if (!meta.has(row.key)) {
        meta.set(row.key, { label: row.label, section: row.section });
        order.push(row.key);
      }
    }
    return map;
  });

  const sections: MergedSection[] = [];
  const sectionIndex = new Map<string, number>();
  for (const key of order) {
    const { label, section } = meta.get(key)!;
    const cells: MergedCell[] = byScene.map((map) => {
      const row = map.get(key);
      if (!row) return null;
      return row.num === undefined ? { value: row.value } : { value: row.value, num: row.num };
    });
    const merged: MergedRow = { key, label, cells, diff: rowDiff(cells) };
    const at = sectionIndex.get(section);
    if (at === undefined) {
      sectionIndex.set(section, sections.length);
      sections.push({ section, rows: [merged] });
    } else {
      sections[at]!.rows.push(merged);
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// the dash wall
// ---------------------------------------------------------------------------

/** A section's rows split for display: everyone has these / only some do. */
export type SectionPartition = { shared: MergedRow[]; partial: MergedRow[] };

/**
 * Split a section's rows by CELL PRESENCE: `shared` = every column has a
 * value, `partial` = at least one column is missing one. Original order is
 * preserved inside each group.
 *
 * Why (measured, not theoretical): on the real guolu+shangzhong 对比 project
 * the merged table came out 44 rows of which only 12 actually compare — 32
 * were "value | —", 30 of them stacked in a single section, because
 * per-entity keys never intersect across factories with disjoint equipment.
 * A wall of dashes is noise, not comparison: it costs the reader as much
 * attention as a real row and answers nothing. Collapsing it is 减法 — the
 * facts are still there, one disclosure away.
 *
 * Presence is the ONLY criterion, so this stays as capability-agnostic as the
 * rest of the module: no key, section or naming convention is consulted, and a
 * server shipping entirely different keys next month partitions just as well.
 */
export function partitionSectionRows(rows: readonly MergedRow[]): SectionPartition {
  const shared: MergedRow[] = [];
  const partial: MergedRow[] = [];
  for (const row of rows) {
    (row.cells.every((c) => c !== null) ? shared : partial).push(row);
  }
  return { shared, partial };
}
