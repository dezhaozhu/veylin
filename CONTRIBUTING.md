# Contributing to Veylin

Thanks for your interest in contributing! Veylin is an open-source, self-hosted
industrial AI agent. Bug reports, feature ideas, docs, and pull requests are all
welcome.

## Development setup

Requirements: **Node.js >= 22** and npm. For desktop builds you also need the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust toolchain).

```bash
git clone https://github.com/veylin-ai/veylin.git
cd veylin
cp .env.example .env          # add a model API key
npm install
npm run dev                   # server :8787 + web :5174
```

No Docker, Postgres, or Redis is required — data is stored in an embedded
SurrealDB under `VEYLIN_DATA_DIR` (default `~/.veylin`).

## Before opening a pull request

```bash
npm run typecheck             # tsc across the workspace
npm test                      # unit tests (vitest)
```

- Keep changes focused; one logical change per PR.
- Match the existing code style. Do not introduce unrelated refactors.
- Shared/core files (runtime, server, db, shared, web logic) are kept
  domain-neutral and product-neutral — keep distribution-specific content out of
  them.
- All new user-facing strings must go through i18n (`react-i18next`) with both
  `en` and `zh-CN` entries in `apps/web/src/i18n/locales/`.

## Internationalization

English is the default language. When adding UI text:

1. Add a key under `apps/web/src/i18n/locales/en.json`.
2. Add the matching translation under `apps/web/src/i18n/locales/zh-CN.json`.
3. Reference it with `t('your.key')` / `i18n.t('your.key')`.

## Commit messages

Use clear, imperative messages (e.g. `fix: handle empty schedule sheet`). Group
related changes together.

## Reporting bugs

Open an issue with reproduction steps, expected vs. actual behavior, your OS, and
the app/commit version. For security issues, follow [SECURITY.md](./SECURITY.md)
instead of opening a public issue.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
