# Veylin

English · [简体中文](./README.zh-CN.md)

> An open-source, **self-hosted industrial AI agent** desktop app. A complete tool-calling agent with **no-code automation**, a **permission- and privacy-first** design, and a unified, DIY **right-side panel** system — table, web, RAG, knowledge graph, and workflow.

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20React-24C8DB">
  <img alt="Storage" src="https://img.shields.io/badge/storage-embedded%20SurrealDB-ff00a0">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22-339933">
</p>

Veylin is a ground-up redesign of an industrial agent platform. It runs on a **single embedded SurrealDB engine** (documents + graph + vector + full-text), an agent runtime core, a thin Fastify BFF, and a Tauri + React client. Packaged as a desktop app it is **double-click to run**: the server ships as a sidecar binary with an embedded Node runtime, so end users need no separate Node / Docker / Postgres / Redis install.

## Why Veylin

- **A complete agent** — built-in tool calling, plan mode, subagents, skills and memory; it carries a task through end to end.
- **No code required** — visual workflow orchestration, scheduled and event-driven automation, and skill / rule / MCP configuration are all done in the UI.
- **Permission- and privacy-first** — local-first, single-machine self-hosting; risky actions go through an approval gate; your data stays on your machine by default.
- **Industrial, general-purpose** — not tied to one industry; the concrete domain role is injected via `agent.yaml`.
- **Between "hand-rolled" and "all-in-one"** — easy to DIY, yet works out of the box.
- **Enterprise self-hosted** — zero external dependencies, runs fully offline.
- **Unified, DIY right-side panels** — Table · Web · Knowledge (RAG) · Knowledge Graph · Workflow.
- **Fully internationalized** — English by default, switchable to Simplified Chinese; the agent replies in your UI language.

## Quick start (development)

```bash
cp .env.example .env          # add your model key; data goes to ./data by default
npm install
npm run dev                   # server :8787 + web :5174 (data initializes itself, no Docker)
```

The data directory is set by `VEYLIN_DATA_DIR` (default `~/.veylin`); on first run it creates the SurrealDB schema and seed data automatically. In desktop mode, `VEYLIN_DESKTOP_AUTH=1` enables single-tenant, no-login access.

## Build the desktop app (double-click to run)

```bash
npm run -w @veylin/desktop build  # builds the web app → bundles the sidecar (embedded Node + SurrealDB native modules) → tauri build
```

Artifacts:

- macOS: `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg` (+ `.app`)
- Windows: `*.msi` / `*.exe`; Linux: AppImage / deb

After installing, double-click: Tauri starts the sidecar → embedded Node runs `server.mjs` → SurrealDB (surrealkv) initializes automatically → the frontend talks to the local sidecar over `/api`.

Desktop packages do **not** ship with model credentials. Open the bottom-left user menu → **Settings** → **Models** and add your own OpenAI-compatible API key before chatting.

## Architecture

```
Tauri shell (apps/desktop)
  └─ React + assistant-ui (apps/web) ── AI SDK useChat streaming
        └─ veylin-server sidecar (apps/server) ── single-tenant / no-login + SSE + policy gate + in-process queue
              └─ Runtime (packages/runtime) ── Agent / Network / Processors / Memory
                    ├─ Tools (packages/tools, packages/mcp-servers)
                    ├─ Policy (packages/policy)
                    ├─ Embedded SurrealDB (packages/db) ── business tables + knowledge graph / vector / full-text
                    └─ Local LibSQL ── thread memory + semantic-recall vectors
```

## Packages

| Package | Responsibility |
|---------|----------------|
| `@veylin/shared` | Types, AG-UI event protocol, zod schemas |
| `@veylin/db` | Embedded SurrealDB client + SurrealQL schema + business / schedule / RAG repositories |
| `@veylin/runtime` | Runtime assembly: agents / network / processors / memory (LibSQL + fastembed) |
| `@veylin/tools` | Built-in tools (shell / file / grep / glob / web / todo / skill) |
| `@veylin/mcp-servers` | Industrial MCP servers written with the MCP TS SDK (compiled to `.mjs`, started by embedded Node) |
| `@veylin/policy` | Permission / sandbox / approval policy, Plan Mode |
| `@veylin/agent-package` | `agent.yaml` definitions + skills loader |
| `@veylin/server` | Fastify BFF (incl. sidecar bundling script) |
| `@veylin/web` | React + assistant-ui frontend |
| `apps/desktop` | Tauri shell (externalBin sidecar + bundled resources) |

## Customize & Automate

Veylin provides a full-screen Settings surface (left nav + right content).

### Customize

- **Skills** — disable built-in skills; full CRUD for custom skills. Selecting a skill in the composer auto-activates it via `pendingSkill`.
- **Rules** — `always` / `keyword` rules injected into the system prompt.
- **MCP** — bundled stdio servers are read-only; remote SSE/HTTP servers can be added/edited/removed, with the toolset refreshed on write.

API: `GET/POST/PUT/DELETE /api/skills`, `/api/rules`, `/api/mcp-servers`

### Automate

- **Scheduled** — an `automations` table + in-process queue (node-cron); each run creates a new thread, writes to `automation_runs`, and appears in the conversation list.
- **Event-driven** — `POST /api/events/{tenantId}/{source}` (HMAC verification); matching `kind=event` automations via OpenHands-style `on` + JMESPath `filter` are dispatched to the queue.
- **Agent tools** — `automation_create` / `automation_list` / `automation_enable` / `automation_trigger` / `automation_update` / `automation_delete`.

API: `GET/POST/PUT/DELETE /api/automations`, `POST /api/automations/:id/trigger`, `GET /api/automations/:id/runs`, `GET/POST/DELETE /api/webhooks`

## Internationalization

The UI defaults to English and can be switched to Simplified Chinese from the user menu (bottom-left). The selection is persisted in `localStorage`, and the agent replies in the active UI language.

## Security

See [SECURITY.md](./SECURITY.md). For any shared or production deployment, set `AUTH_SECRET` and disable desktop no-login mode.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Veylin contributors
