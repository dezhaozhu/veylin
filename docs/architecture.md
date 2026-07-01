# Veylin Architecture

Veylin is an npm workspaces monorepo: self-hosted AI agent desktop app (Tauri + Fastify + React).

## Layering

| Layer | Package / app | Responsibility |
|-------|----------------|----------------|
| Contracts | `@veylin/shared` | Types, Zod schemas, pure helpers (skills, plan mode, messages, models) |
| Node-only shared | `@veylin/shared/node` | Model catalog file I/O and runtime overrides (server/tools only) |
| Persistence | `@veylin/db` | SurrealDB client and repositories |
| Tools | `@veylin/tools` | Mastra builtin tools (no HTTP) |
| Policy | `@veylin/policy` | Tool approval and plan-mode allowlists |
| Runtime | `@veylin/runtime` | Agent assembly, memory, prompts |
| Orchestration | `@veylin/server` | HTTP routes, tenant context, stream recovery, stores |
| UI | `@veylin/web` | Composer, panels, settings |
| Shell | `@veylin/desktop` | Tauri wrapper and sidecar lifecycle |

Dependency rule: **apps → packages**, never `packages → apps`. Prefer `shared` at the bottom; `tools` must not depend on `runtime`.

```
apps/web ──► @veylin/shared
apps/server ──► runtime, tools, db, shared, mcp-servers
packages/runtime ──► db, agent-package, policy, shared, tools
packages/tools ──► shared (not runtime)
packages/policy ──► shared, tools
```

## Import paths

- **Web app internals:** `@/*` → `apps/web/src/*`
- **Cross-workspace:** `@veylin/<package>` only — no `../../packages/...`
- **Third-party internals:** do not import `node_modules/.../src/...` from app code; use `apps/web/src/vendor/` shims

## Authoritative state

| Concern | Source of truth | Notes |
|---------|-----------------|-------|
| Plan mode | `thread_state.planMode` in DB | Server writes on enter/exit tools and `/api/plan-mode`; tools Map is request-scoped cache |
| Chat transcript | Mastra memory + client sync | `/api/threads/:id/messages` for client-authoritative sync |
| Model provider | Tenant `model_settings` + optional `models.local.json` catalog | Server applies overrides to runtime on each chat |
| Skills | Agent package + custom skills in DB | `user-invocable: false` hidden from composer slash menu |
| Resumable streams | In-memory store in server | `stream not found` = resume id expired or different instance |

## Server layout

`apps/server/src/server.ts` boots Fastify and registers domain routes from `apps/server/src/routes/`. Each route module receives a `ServerDeps` context (runtime, queue, MCP helpers, `resolveContext`).

## Model settings migration

Legacy DB fields (`openaiApiKey`, `providerName`, etc.) are **read-only migration** in `model-settings-store.ts`. New writes use `modelName`, `requestUrl`, `apiKey` only.

## Testing

- Unit: Node `node:test` + `tsx`, `*.test.ts` beside source
- Root `npm test`: shared → db → tools → policy → runtime → server → web
- E2E: Playwright in `apps/web/e2e/`, `webServer` starts API + Vite dev

## Sidecar (desktop)

Desktop bundles `apps/server/dist/sidecar`. After server changes, run `npm run -w @veylin/server build:sidecar` before shipping or testing the packaged app.
