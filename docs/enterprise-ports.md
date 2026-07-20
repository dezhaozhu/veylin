# Enterprise ports (shell adapters)

Veylin Host exposes swappable ports. Defaults are complete enough to run locally; enterprises replace identity / audit sinks without forking the agent runtime.

## Environment

| Variable | Values | Meaning |
|----------|--------|---------|
| `VEYLIN_DESKTOP_AUTH` | `1` / `0` | Desktop bypass (`identity=desktop`) |
| `IDENTITY_PROVIDER` | `local` (default) \| `oidc` \| `webhook` \| `desktop` | Identity adapter |
| `AUTH_SECRET` | string | Required for `local` |
| `AUTH_BASE_URL` | URL | better-auth base URL |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `0`/`1` | Optional email verify (needs SMTP via better-auth config later) |
| `IDENTITY_WEBHOOK_URL` | URL | `webhook` provider: GET with Cookie/Authorization → `{ user: { id, email?, name? } }` |
| `IDENTITY_OIDC_USERINFO_URL` | URL | `oidc`: Bearer → userinfo JSON (`sub`/`id`) |
| `IDENTITY_OIDC_INTROSPECTION_URL` | URL | Alternative to userinfo |
| `IDENTITY_OIDC_CLIENT_ID` / `SECRET` | string | Introspection basic auth |
| `AUDIT_WEBHOOK_URL` | URL | Optional env fallback sink (tenant UI setting preferred) |
| `VEYLIN_RBAC_FILTER_TOOLS` | `0`/`1` | When `1`, `member` role prefers read-like MCP tool names |

## Ports

- **IdentityPort** — `getSession`; local also uses `/api/auth/*` for sign-up/sign-in
- **OrgDirectoryPort** — personal tenant by default; `listMembers`; optional role tool filter
- **BusinessSourcePort** — Settings → Business; wraps one MCP with allowlist
- **AuditPort** — Surreal `audit_log` + optional webhook (Settings → Business, or `AUDIT_WEBHOOK_URL`); `GET /api/audit-logs` still available for API consumers

## Minimal enterprise connect (tier A)

1. Deploy an MCP that wraps the business API.
2. In Veylin Settings → **Business**, set MCP URL + Authorization + allowlist, enable.
3. Use **Test connection** (`POST /api/business-source/test`) to verify tools list.
4. Chat; agent only sees allowlisted tools; calls are audited (configure Webhook under Settings → Business, or `GET /api/audit-logs`).

## Identity replace (tier B)

1. Set `IDENTITY_PROVIDER=oidc` (or `webhook`) and the URLs above.
2. Do **not** use local register; employees authenticate at the IdP and send Bearer/Cookie that Host can resolve via `getSession`.
3. Business source config stays the same.

## Probe

`GET /api/enterprise/ports` (unauthenticated) returns active adapter ids and `supportsLocalCredentials`.
