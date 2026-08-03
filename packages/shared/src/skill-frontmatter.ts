/** Claude Code–compatible SKILL.md frontmatter parsing and catalog formatting. */

export const SKILL_CATALOG_DESCRIPTION_MAX = 1536;

export type SkillFrontmatter = {
  name?: string;
  description?: string;
  whenToUse?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
};

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

const BLOCK_SCALAR = /^([>|])([-+])?$/;

/**
 * Read a YAML scalar that may be inline or a block (`>` / `|`).
 * Folded (`>`) lines are joined with spaces; literal (`|`) keeps newlines.
 */
function readScalar(yaml: string, key: string): string | undefined {
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;
    const rest = match[1]!.trim();
    const block = rest.match(BLOCK_SCALAR);
    if (block) {
      const style = block[1]!; // '>' | '|'
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!;
        if (next.trim() === '') {
          // Blank line ends the block unless the following line is still indented.
          if (j + 1 < lines.length && /^\s+\S/.test(lines[j + 1]!)) {
            body.push('');
            continue;
          }
          break;
        }
        if (!/^\s/.test(next)) break;
        body.push(next.replace(/^\s+/, ''));
      }
      if (body.length === 0) return undefined;
      if (style === '|') {
        return body.join('\n').trim() || undefined;
      }
      return (
        body
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim() || undefined
      );
    }
    if (!rest) return undefined;
    return unquoteYamlScalar(rest);
  }
  return undefined;
}

/** Parse supported YAML frontmatter keys from SKILL.md. */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1]!;

  const whenToUse =
    readScalar(yaml, 'when_to_use') ??
    readScalar(yaml, 'when-to-use');

  return {
    ...(readScalar(yaml, 'name') ? { name: readScalar(yaml, 'name') } : {}),
    ...(readScalar(yaml, 'description')
      ? { description: readScalar(yaml, 'description') }
      : {}),
    ...(whenToUse ? { whenToUse } : {}),
    ...(parseBool(readScalar(yaml, 'disable-model-invocation')) != null
      ? {
          disableModelInvocation: parseBool(
            readScalar(yaml, 'disable-model-invocation'),
          ),
        }
      : {}),
    ...(parseBool(readScalar(yaml, 'user-invocable')) != null
      ? { userInvocable: parseBool(readScalar(yaml, 'user-invocable')) }
      : {}),
  };
}

/** Markdown body after frontmatter (unchanged when no frontmatter). */
export function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return content;
  return content.slice(match[0].length).trimStart();
}

/** Catalog line description: description + when_to_use, capped for token budget. */
export function formatSkillCatalogDescription(
  frontmatter: SkillFrontmatter,
  fallback = '',
): string {
  const parts = [frontmatter.description?.trim(), frontmatter.whenToUse?.trim()].filter(
    Boolean,
  ) as string[];
  const combined = parts.length > 0 ? parts.join(' ') : fallback.trim();
  if (combined.length <= SKILL_CATALOG_DESCRIPTION_MAX) return combined;
  return `${combined.slice(0, SKILL_CATALOG_DESCRIPTION_MAX - 1).trimEnd()}…`;
}

/** Body injected on activation: no frontmatter, optional base directory hint. */
export function skillActivationBody(content: string, baseDir?: string): string {
  const body = stripSkillFrontmatter(content).trim();
  if (!baseDir) return body;
  return `Base directory for this skill: ${baseDir}\n\n${body}`;
}
