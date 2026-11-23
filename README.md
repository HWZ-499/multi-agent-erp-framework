# Multi-Agent Microkernel ERP Framework

A **portable, production-style Multi-Agent Architecture** for complex full-stack systems with databases, cross-module dependencies, and multi-vendor AI coding agents.

## Core Framework Mechanisms

1. **Per-Slot SQLite Schemas (`node:sqlite` + `src/modules/<slot>/schema.sql`)**
   Each module owns its own table prefix (`inventory_*`, `orders_*`, `billing_*`, `audit_*`) and DDL file. The microkernel executes all slot schemas automatically at boot—eliminating central `schema.prisma` merge conflicts.
2. **Cross-Module Service Bus with Automatic `[STUB]` Fallback Mocks (`src/core/kernel.mjs`)**
   Modules **never import each other**. Every cross-module dependency (`orders` -> `inventory`, `orders` -> `billing`) goes through `ctx.services.<slot>.<method>(...)`. When a target module is still `[STUB]`, the kernel seamlessly serves frozen contract mocks from `src/types/contracts.mjs`, enabling dependent modules to be built and tested concurrently!
3. **Decoupled Event Bus (`ctx.bus`)**
   Modules publish domain events (`inventory.reserved`, `order.created`, `invoice.created`) without knowing who listens.
4. **Physical CI Boundary & Anti-Coupling Guard (`scripts/check-boundaries.mjs` + `.github/workflows/boundary-guard.yml`)**
   Automatically fails PRs that touch files outside their assigned `src/modules/<slot>/` folder or introduce relative imports across module boundaries.

## Quick Start

```bash
# Run CLI cross-module workflow
npm start

# Start ERP Workbench Web App (http://localhost:3095)
npm run serve

# Run boundary guard & all unit tests
npm run check:boundaries
npm test
```
