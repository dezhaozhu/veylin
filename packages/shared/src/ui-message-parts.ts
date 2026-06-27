/** Obsolete or mis-parsed tool part types dropped on load/persist. */
const OBSOLETE_UI_PART_TYPES = new Set(['tool-invocation']);
const MISPARSED_TOOL_SUFFIXES = new Set(['invocation', 'call']);

export function isObsoleteUiMessagePart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const type = (part as { type?: string }).type;
  if (!type) return false;
  if (OBSOLETE_UI_PART_TYPES.has(type)) return true;
  if (type.startsWith('tool-')) {
    const name = type.slice('tool-'.length);
    if (MISPARSED_TOOL_SUFFIXES.has(name)) return true;
  }
  return false;
}

export function filterPersistableUiMessageParts<T>(parts: T[] | undefined): T[] {
  if (!parts) return [];
  return parts.filter((part) => !isObsoleteUiMessagePart(part));
}
