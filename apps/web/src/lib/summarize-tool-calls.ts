import i18n from '@/i18n';

const TOOL_VERB: Record<string, 'read' | 'edited' | 'explored' | 'ran' | 'searched'> = {
  read_file: 'read',
  Read: 'read',
  read: 'read',
  edit_file: 'edited',
  write: 'edited',
  write_file: 'edited',
  search_replace: 'edited',
  Edit: 'edited',
  grep: 'explored',
  glob: 'explored',
  list_dir: 'explored',
  list_directory: 'explored',
  codebase_search: 'explored',
  bash: 'ran',
  shell: 'ran',
  tool_search: 'searched',
};

function labelForVerb(
  verb: 'read' | 'edited' | 'explored' | 'ran' | 'searched',
  count: number,
): string {
  switch (verb) {
    case 'read':
      return i18n.t('toolGroup.readFiles', { count });
    case 'edited':
      return i18n.t('toolGroup.editedFiles', { count });
    case 'explored':
      return i18n.t('toolGroup.exploredFiles', { count });
    case 'ran':
      return i18n.t('toolGroup.ranCommands', { count });
    case 'searched':
      return i18n.t('toolGroup.searchedTools', { count });
  }
}

/** Collapsed summary line for a tool-call group (Cursor / agent-style). */
export function summarizeToolCalls(toolNames: string[]): string {
  if (toolNames.length === 0) return i18n.t('toolGroup.toolCalls', { count: 0 });
  if (toolNames.length === 1) return i18n.t('toolGroup.toolCalls', { count: 1 });

  const buckets = new Map<'read' | 'edited' | 'explored' | 'ran' | 'searched', number>();
  let unknown = 0;

  for (const name of toolNames) {
    const verb = TOOL_VERB[name];
    if (verb) {
      buckets.set(verb, (buckets.get(verb) ?? 0) + 1);
    } else {
      unknown += 1;
    }
  }

  const parts: string[] = [];
  for (const verb of ['edited', 'explored', 'read', 'ran', 'searched'] as const) {
    const count = buckets.get(verb);
    if (count) parts.push(labelForVerb(verb, count));
  }
  if (unknown > 0) {
    parts.push(i18n.t('toolGroup.toolCalls', { count: unknown }));
  }

  return parts.length > 0
    ? parts.join(i18n.t('toolGroup.summaryJoin'))
    : i18n.t('toolGroup.toolCalls', { count: toolNames.length });
}
