# GitHub Copilot Coding Agent Instructions

Follow `AGENTS.md` and `src/types/contracts.mjs`:
1. Only edit files inside your assigned `src/modules/<slot>/` folder.
2. Never import files across modules (`../<other>`). Use `ctx.services` and `ctx.bus`.
3. Prefix SQLite tables with `<slot>_` in `src/modules/<slot>/schema.sql`.
4. Run `node scripts/check-boundaries.mjs` and `node --test src/modules/<slot>/index.test.mjs`.
