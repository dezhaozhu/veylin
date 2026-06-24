const TOOL_VERB: Record<string, 'read' | 'edited' | 'explored' | 'ran'> = {
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
};

function labelForVerb(verb: 'read' | 'edited' | 'explored' | 'ran', count: number): string {
  switch (verb) {
    case 'read':
      return `Read ${count} file${count === 1 ? '' : 's'}`;
    case 'edited':
      return `Edited ${count} file${count === 1 ? '' : 's'}`;
    case 'explored':
      return `Explored ${count} file${count === 1 ? '' : 's'}`;
    case 'ran':
      return `Ran ${count} command${count === 1 ? '' : 's'}`;
  }
}

/** Collapsed summary line for a tool-call group (Cursor / agent-style). */
export function summarizeToolCalls(toolNames: string[]): string {
  if (toolNames.length === 0) return '0 tool calls';
  if (toolNames.length === 1) return '1 tool call';

  const buckets = new Map<'read' | 'edited' | 'explored' | 'ran', number>();
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
  for (const verb of ['edited', 'explored', 'read', 'ran'] as const) {
    const count = buckets.get(verb);
    if (count) parts.push(labelForVerb(verb, count));
  }
  if (unknown > 0) {
    parts.push(`${unknown} tool call${unknown === 1 ? '' : 's'}`);
  }

  return parts.length > 0 ? parts.join(', ') : `${toolNames.length} tool calls`;
}
