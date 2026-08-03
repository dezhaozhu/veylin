# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories
("Report a vulnerability" on the Security tab) rather than opening a public
issue. We aim to acknowledge reports within a few business days.

## Authentication model

Veylin ships primarily as a single-user **desktop application**. In that mode
the bundled server listens on `127.0.0.1` only and authentication is disabled
on purpose (`VEYLIN_DESKTOP_AUTH=1`). This keeps the double-click experience
friction-free while keeping the surface on the local machine.

If you deploy Veylin in any **shared or hosted** environment:

- Set `VEYLIN_DESKTOP_AUTH=0`.
- Set a strong, random `AUTH_SECRET`. When `AUTH_SECRET` is unset the server
  falls back to no-auth mode, which is only safe on a trusted localhost.
- Put the server behind TLS and tighten CORS when `VEYLIN_DESKTOP_AUTH=0`
  (`CORS_ALLOWED_ORIGINS=http://localhost:5174,...`; desktop mode keeps permissive CORS).

## Data & secrets

- Model API keys are read from environment variables only; none are bundled.
- All application data lives locally in `VEYLIN_DATA_DIR` (default `~/.veylin`):
  the embedded SurrealDB store and the LibSQL memory database. Nothing is sent
  anywhere except to the model/MCP endpoints you configure.
- Never commit a real `.env`; only `.env.example` is tracked.

## Supported versions

Security fixes target the latest released version. Pre-1.0 releases may not
receive backports.
