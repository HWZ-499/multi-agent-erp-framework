# Multi-Agent Microkernel ERP Collaboration Rules

This repository implements a **Portable Multi-Agent Microkernel Framework** for complex full-stack applications using:
- Per-slot SQLite schemas (`node:sqlite` + `src/modules/<slot>/schema.sql`)
- Cross-module **Service Bus** (`ctx.services.<slot>.<method>`) with automatic `[STUB]` fallback mocks
- Cross-module **Event Bus** (`ctx.bus.on` / `ctx.bus.emit`)
- Physical CI Boundary & Anti-Coupling Guard (`scripts/check-boundaries.mjs`)

## 1. Strict Territory Ownership

| Agent Role | Assigned Branch | Exclusive Territory | Unit Test Command |
| :--- | :--- | :--- | :--- |
| **Agent-Inventory** | `feat/agent-inventory` | `src/modules/inventory/**` | `node --test src/modules/inventory/index.test.mjs` |
| **Agent-Codex-Orders** | `feat/codex-orders` | `src/modules/orders/**` | `node --test src/modules/orders/index.test.mjs` |
| **Agent-OpenCode-Billing** | `feat/opencode-billing` | `src/modules/billing/**` | `node --test src/modules/billing/index.test.mjs` |
| **Agent-Audit** | `feat/agent-audit` | `src/modules/audit/**` | `node --test src/modules/audit/index.test.mjs` |

## 2. Shared Hotspot Lock (Forbidden Files)

All feature agents are **strictly forbidden** from modifying any file outside their assigned `src/modules/<slot>/` folder:
- `package.json`, `README.md`, `AGENTS.md`, `TASKS.md`, `CLAUDE.md`, `.cursorrules`, `.github/**`, `scripts/**`
- `src/index.mjs`, `src/server.mjs`
- `src/core/**` (Microkernel is frozen)
- `src/types/**` (Service contracts & stub mocks are frozen)
- Any other module's `src/modules/<other>/**` folder

## 3. Anti-Coupling Iron Law (Zero Cross-Module Imports)

1. **NEVER** write `import ... from '../inventory/...'` or `../billing/...` or `../orders/...` or `../audit/...`.
2. All cross-module calls **MUST** go through `await ctx.services.<targetSlot>.<method>(...)` or `ctx.bus.emit(...)` / `ctx.bus.on(...)`.
3. Every SQLite table created in `src/modules/<slot>/schema.sql` **MUST** be prefixed with `<slot>_` (e.g. `inventory_items`, `orders_records`, `billing_invoices`, `audit_logs`).
4. Run `node scripts/check-boundaries.mjs` and `node --test src/modules/<your-slot>/index.test.mjs` before finishing.
