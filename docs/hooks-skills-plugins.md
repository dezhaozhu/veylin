# Hooks, Skills directories, and Plugins

## Layout (`~/.veylin`)

| Path | Purpose |
|------|---------|
| `skills/<name>/SKILL.md` | User skills |
| `rules/<name>.md` | User rules (frontmatter: trigger, keywords, enabled) |
| `hooks.json` | User hooks |
| `settings.json` | disabledSkills / disabledHooks / disabledMcpServers, workspaceRoot |
| `mcp.json` + `mcp.local.json` | Remote MCP (secrets in `.local`) |
| `plugins.json` | Plugin install metadata |
| `plugins/<name>/` | Installed plugin packages |

Project hooks (optional): `<workspace>/.veylin/hooks.json` when a workspace root is set.

**Agent:** use `config_read` / `config_write` for the files above (allowlisted). Automations and webhooks stay in the database and are edited only in **Settings**.

## Skills

| Source | Path |
|--------|------|
| user | `~/.veylin/skills/*/SKILL.md` |
| bundled | agent package `skills/` (read-only in UI) |
| plugin | enabled plugins' `skills/` (namespaced `plugin:skill`) |

Copy a skill folder into `~/.veylin/skills/`, use **Customize → Skills → Add skill**, or ask the agent to `config_write` a `SKILL.md`. Veylin does **not** live-scan `~/.agents` or other products' skill dirs.

## Hooks

Claude Code–compatible lifecycle hooks.

- User (CRUD in UI / files): `~/.veylin/hooks.json`
- Project (optional): workspace `.veylin/hooks.json`
- Plugin: `<plugin>/hooks/hooks.json`
- Disabled keys: `settings.json` → `disabledHooks`

Handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent`.

## Plugins

```
my-plugin/
  .veylin-plugin/plugin.json
  skills/*/SKILL.md
  hooks/hooks.json
  .mcp.json          # optional
```

Install via **Customize → Plugins** (path, git, or marketplace). Packages under `~/.veylin/plugins/<name>/`; metadata in `plugins.json`.
