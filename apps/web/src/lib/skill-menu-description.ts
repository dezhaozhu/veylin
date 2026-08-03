/** One-line summary for composer skill pickers (full description stays in SKILL.md for the model). */
export function skillMenuDescription(description: string | undefined): string | undefined {
  if (!description?.trim()) return undefined;
  const flat = description.replace(/\s+/g, ' ').trim();
  const max = 56;
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}
