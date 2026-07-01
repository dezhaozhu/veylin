export const FORK_SUBAGENT_TYPE = 'fork';
export const FORK_TAG = 'veylin-fork';

export function isForkDirective(text: string): boolean {
  return text.includes(`<${FORK_TAG}>`);
}

export function buildForkDirectiveBlock(name: string, directive: string): string {
  return `<${FORK_TAG}>\nDirective (${name}):\n${directive}\n</${FORK_TAG}>`;
}

/** Prompt for a fork child — inherits seeded parent thread context. */
export function forkWorkerEnvelope(name: string, directive: string): string {
  return [
    'You are a fork of the parent agent. The messages above are the parent conversation context.',
    'Complete the directive below autonomously with your full tool access.',
    'You CANNOT dispatch further subagents or forks.',
    'Do not ask the user questions — state assumptions and proceed.',
  ].join('\n') + `\n\n${buildForkDirectiveBlock(name, directive)}`;
}
