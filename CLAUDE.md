# CLAUDE.md — Anthropic Claude Code Rules

Read `AGENTS.md`, `TASKS.md`, and `src/types/contracts.mjs` before making any changes.

## Territory Ownership
- `src/modules/inventory/**` -> Inventory module only
- `src/modules/orders/**` -> Orders module only (Codex)
- `src/modules/billing/**` -> Billing module only (OpenCode)
- `src/modules/audit/**` -> Audit module only

## Forbidden Rules
- Never touch `package.json`, `README.md`, `AGENTS.md`, `TASKS.md`, `CLAUDE.md`, `.cursorrules`, `.github/**`, `scripts/**`, `src/core/**`, `src/types/**`, `src/server.mjs`, `src/index.mjs`.
- Never import files from another module (`../<other-slot>`). Always use `ctx.services` or `ctx.bus`.
- Run `node scripts/check-boundaries.mjs` and `node --test src/modules/<your-slot>/index.test.mjs`.
