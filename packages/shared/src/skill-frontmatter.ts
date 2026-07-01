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

function readScalar(yaml: string, key: string): string | undefined {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? unquoteYamlScalar(match[1]!) : undefined;
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
