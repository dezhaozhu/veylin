export function pendingSkillToken(skillName: string): string {
  return `/${skillName}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove the pending-skill token from outgoing user text (Claude Code: command not in user message). */
export function stripAllPendingSkillTokens(
  text: string,
  skillName: string | null,
  insertAt?: number,
): string {
  if (!skillName) return text;
  const token = pendingSkillToken(skillName);

  if (
    insertAt != null &&
    text.slice(insertAt, insertAt + token.length) === token
  ) {
    const before = text.slice(0, insertAt);
    let after = text.slice(insertAt + token.length);
    if ((before === '' || before.endsWith(' ')) && after.startsWith(' ')) {
      after = after.slice(1);
    }
    return `${before}${after}`;
  }

  let out = text;
  let index = out.indexOf(token);
  while (index !== -1) {
    const before = out.slice(0, index);
    let after = out.slice(index + token.length);
    if ((before === '' || before.endsWith(' ')) && after.startsWith(' ')) {
      after = after.slice(1);
    }
    out = `${before}${after}`;
    index = out.indexOf(token, index);
  }
  return out;
}
