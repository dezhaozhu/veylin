/** Human-readable names for built-in subagent presets. */
export const SUBAGENT_PRESET_DISPLAY: Record<string, string> = {
  explore: 'Explore',
  plan: 'Plan',
  'general-purpose': 'General',
  verification: 'Verification',
  editor: 'Editor',
  fork: 'Fork',
};

export type TaskDisplayFields = {
  id: string;
  label?: string | null;
  agentId: string;
  subagentType?: string | null;
  prompt?: string | null;
};

function firstMeaningfulLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('You are the "') && trimmed.includes(' subagent dispatched')) {
      continue;
    }
    return trimmed;
  }
  return null;
}

/** Pull the delegated directive from a subagent prompt envelope or raw fork prompt. */
export function extractTaskPromptDirective(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const followUpMarker = '\n---\nFollow-up:\n';
  const followUpIdx = trimmed.lastIndexOf(followUpMarker);
  if (followUpIdx >= 0) {
    const follow = trimmed.slice(followUpIdx + followUpMarker.length).trim();
    const line = firstMeaningfulLine(follow);
    if (line) return line;
  }

  const taskMarker = '\nTask:\n';
  let taskIdx = trimmed.indexOf(taskMarker);
  if (taskIdx < 0 && trimmed.startsWith('Task:\n')) {
    taskIdx = 0;
    const task = trimmed.slice('Task:\n'.length).trim();
    const line = firstMeaningfulLine(task);
    if (line) return line;
  } else if (taskIdx >= 0) {
    const task = trimmed.slice(taskIdx + taskMarker.length).trim();
    const line = firstMeaningfulLine(task);
    if (line) return line;
  }

  return firstMeaningfulLine(trimmed);
}

export function formatSubagentPresetName(key: string): string {
  return SUBAGENT_PRESET_DISPLAY[key] ?? key;
}

export function formatAgentDisplayName(agentId: string): string {
  if (agentId.startsWith('subagent-')) {
    const key = agentId.slice('subagent-'.length);
    return formatSubagentPresetName(key);
  }
  return agentId;
}

/** Choose a stored task label when dispatching a background worker. */
export function deriveTaskLabel(options: {
  description?: string;
  prompt: string;
  subagentType?: string | null;
  agentId: string;
  defaultLabel: string;
}): string {
  const custom = options.description?.trim();
  const preset = options.subagentType?.trim() || null;
  if (custom && (!preset || custom !== preset)) {
    return custom.slice(0, 120);
  }

  const fromPrompt = extractTaskPromptDirective(options.prompt);
  if (fromPrompt) return fromPrompt.slice(0, 120);

  if (!preset) return formatAgentDisplayName(options.agentId).slice(0, 120);
  return options.defaultLabel.slice(0, 120);
}

/** Primary title for a background task row in the UI. */
export function formatTaskDisplayName(task: TaskDisplayFields): string {
  const label = task.label?.trim();
  const preset = task.subagentType?.trim() || null;

  if (label && (!preset || (label !== preset && label !== 'fork'))) {
    return label;
  }

  const fromPrompt = task.prompt ? extractTaskPromptDirective(task.prompt) : null;
  if (fromPrompt) return fromPrompt;

  if (preset && preset !== 'fork') {
    return formatSubagentPresetName(preset);
  }

  return formatAgentDisplayName(task.agentId) || task.id.slice(0, 8);
}

/** Secondary agent/preset kind when it differs from the primary title. */
export function formatTaskAgentKind(task: TaskDisplayFields): string | null {
  const preset = task.subagentType?.trim() || null;
  if (preset && preset !== 'fork') {
    return formatSubagentPresetName(preset);
  }
  if (task.agentId && !task.agentId.startsWith('subagent-')) {
    return formatAgentDisplayName(task.agentId);
  }
  return null;
}
