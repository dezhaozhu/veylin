# Veylin

English · [简体中文](./README.zh-CN.md)

> An open-source, **self-hosted general-purpose AI agent desktop platform**. Claude Code–class agent loops (tools, plan mode, subagents, skills, hooks) plus a DIY workspace — table, knowledge, workflow, and web — so you can ship domain apps on a clean monorepo architecture. Double-click to run: no Docker, Postgres, or Redis.

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20React-24C8DB">
  <img alt="Storage" src="https://img.shields.io/badge/storage-embedded%20SurrealDB-ff00a0">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22-339933">
</p>

![Veylin desktop — chat, customize/automate, and workspace panels](docs/images/veylin-desktop.jpg)

## Who it's for

- Teams that want a **local, privacy-first agent** without standing up a cloud stack
- Builders who need **Claude Code–style agent capability** (plan / subagents / skills / hooks / MCP) out of the box
- Product / domain teams that will **DIY a vertical app** on top of a stable platform (panels, `agent.yaml`, plugins) instead of forking a chat UI from scratch

## Why Veylin

1. **Claude Code–class agent loop** — tool calling, plan mode, goal/loop, subagents (`task`), skills, hooks, approval gates, and context compaction — not just a chat box.
2. **Built for DIY** — customize via Skills / Rules / MCP / Hooks / Plugins and `agent.yaml`; extend the unified right-side panels (table · knowledge · workflow · web) and Settings APIs without rewriting the shell.
3. **Zero-ops local stack** — Tauri desktop + Node sidecar + embedded SurrealDB (docs + graph + vector + full-text). Install and run; no separate Node/Docker/DB for end users.

## Compared to similar projects

| Category | Examples | Veylin |
|----------|----------|--------|
| IDE / CLI coding agents | Cline, Aider, Continue, OpenCode | Not a VS Code extension — coding is one use case; the product is a **desktop agent workspace** |
| Autonomous coding platforms | OpenHands, Goose | Focused on **local desktop + business panels** (table / RAG / workflow), not Docker-sandboxed PR factories |
| Chat / RAG shells | Dify, Open WebUI, AnythingLLM | Stronger **agent runtime** (plan, subagents, hooks, skills, policy) with the same DIY surface |

## Features

### Agent

- Streaming chat with OpenAI-compatible models (BYOK)
- Plan mode, todos, ask-user questions, goal / loop
- Subagents with presets (explore / plan / general-purpose / …)
- Dynamic tool discovery (`tool_search`) for table, knowledge, workflow, config, agent tools
- Context engineering: layered system prompts, microcompact, LLM compaction

### Customize & extend

- **Skills** — bundled / user / plugin; activate from the composer
- **Rules** — always / keyword injection into the system prompt
- **MCP** — remote SSE/HTTP servers; toolset refresh on change
- **Hooks** — Claude Code–compatible lifecycle events (user / project / plugin)
- **Plugins** — path / git / marketplace; ship skills + hooks + MCP together  
  See [docs/hooks-skills-plugins.md](./docs/hooks-skills-plugins.md) and [examples/](./examples/)

### Automate

- Scheduled automations (cron) and event webhooks (HMAC + JMESPath filters)
- Visual **workflow** DAGs in the right panel (agent / knowledge / table / HTTP nodes)

### Workspace panels

Table · Knowledge (RAG + graph) · Workflow · Web — one shell, agent-aware tools on each surface.

## Architecture

```
Tauri shell (apps/desktop)
  └─ React + assistant-ui (apps/web)
        └─ Fastify BFF sidecar (apps/server)
              └─ Runtime (packages/runtime) ── Mastra agents / memory / processors
                    ├─ Tools + MCP (packages/tools, …)
                    ├─ Policy (packages/policy)
                    ├─ Hooks (packages/hooks)
                    ├─ Embedded SurrealDB (packages/db)
                    └─ LibSQL ── thread transcript + semantic recall
```

| Package | Role |
|---------|------|
| `@veylin/shared` | Types, zod schemas, workflow / goal contracts |
| `@veylin/db` | Embedded SurrealDB + table / RAG / workflow repos |
| `@veylin/runtime` | Agent assembly, memory, prompts, subagent presets |
| `@veylin/tools` | Built-in tools + `tool_search` |
| `@veylin/policy` | Risk levels, approval, plan-mode allowlist |
| `@veylin/hooks` | Hook bus / loader (Claude Code–compatible events) |
| `@veylin/agent-package` | `agent.yaml` + skills loader |
| `@veylin/server` | Fastify BFF + sidecar bundle |
| `@veylin/web` | React UI |
| `apps/desktop` | Tauri shell + sidecar lifecycle |

Deeper notes: [docs/architecture.md](./docs/architecture.md).

## Quick start (development)

```bash
cp .env.example .env          # add your model key
npm install
npm run dev                   # server :8787 + web :5174
# or desktop:
npm run -w @veylin/desktop dev
```

Data directory: set `VEYLIN_DATA_DIR` (dev defaults to the repo `./data`). Desktop no-login mode uses `VEYLIN_DESKTOP_AUTH=1`.

## Build the desktop app

```bash
npm run -w @veylin/desktop build
```

Artifacts under `apps/desktop/src-tauri/target/release/bundle/` (dmg / msi / AppImage / deb). Packaged apps store data under the OS app-data directory (e.g. Application Support on macOS) unless `VEYLIN_DATA_DIR` is set.

Desktop builds do **not** ship model credentials — open **Settings → Models** and add your API key before chatting.

## Security

See [SECURITY.md](./SECURITY.md). For shared or production deployments, set `AUTH_SECRET` and disable desktop no-login mode.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Veylin contributors
