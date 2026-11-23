# External Agent Tasks (`TASKS.md`)

Read **`AGENTS.md`** and **`src/types/contracts.mjs`** first.
Remember:
- **Zero Cross-Module Imports**: NEVER import `../inventory`, `../orders`, `../billing`, or `../audit`. Use `ctx.services.<slot>.<method>(...)` and `ctx.bus.emit(...)`.
- **Zero Hotspot Edits**: ONLY modify/create files inside your assigned `src/modules/<your-slot>/` folder.
- **Verify Before Pushing**: Run `node scripts/check-boundaries.mjs` and `node --test src/modules/<your-slot>/index.test.mjs`.

---

## Task A (Assigned to OpenAI Codex) — Order Orchestration Module (`src/modules/orders/`)
- **Branch**: `feat/codex-orders`
- **Exclusive Territory**: `src/modules/orders/**`
- **Test Command**: `node --test src/modules/orders/index.test.mjs`

### Requirements
1. **`src/modules/orders/schema.sql`**:
   Create table `orders_records`:
   ```sql
   CREATE TABLE IF NOT EXISTS orders_records (
     order_id TEXT PRIMARY KEY,
     customer TEXT NOT NULL,
     sku TEXT NOT NULL,
     qty INTEGER NOT NULL,
     unit_price REAL NOT NULL,
     subtotal REAL NOT NULL,
     tax_amount REAL NOT NULL,
     total_amount REAL NOT NULL,
     invoice_id TEXT NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   ```
2. **`src/modules/orders/index.mjs`**:
   - Set `implemented: true` (keep `id: 'orders'` and `order: 20` unchanged).
   - Implement `services.createOrder(ctx, input)`:
     - Validate `sku` (non-empty string), `qty` (positive integer), `customer` (non-empty string).
     - Resolve `taxRate = typeof input?.taxRate === 'number' && Number.isFinite(input.taxRate) && input.taxRate >= 0 ? input.taxRate : 0.08`.
     - Generate unique `orderId` (if not supplied via `input.orderId`).
     - Call `const reservation = await ctx.services.inventory.reserveStock({ sku, qty, orderId });`
     - Compute `subtotal = roundCurrency(reservation.unitPrice * qty)`.
     - Call `const invoice = await ctx.services.billing.createInvoice({ orderId, customer, subtotal, taxRate });`
     - Insert row into `orders_records` with `status = 'CONFIRMED'` and ISO `created_at`.
     - Emit `ctx.bus.emit('order.created', { orderId, customer, sku, qty, subtotal, totalAmount: invoice.totalAmount, invoiceId: invoice.invoiceId })`.
     - Return `{ orderId, customer, sku, qty, unitPrice: reservation.unitPrice, subtotal, taxAmount: invoice.taxAmount, totalAmount: invoice.totalAmount, invoiceId: invoice.invoiceId, status: 'CONFIRMED', mockedInventory: Boolean(reservation._mock), mockedBilling: Boolean(invoice._mock) }`.
   - Implement `services.listOrders(ctx)` returning all rows ordered newest first (`{ orderId, customer, sku, qty, unitPrice, subtotal, taxAmount, totalAmount, invoiceId, status, createdAt }`).
3. **`src/modules/orders/widget.mjs`**:
   - Export `renderWidget(ctx)` returning `{ slotId: 'orders', title: 'Order Orchestration', badge, summary, metrics, html }`.
   - Must pass `validateWidgetOutput('orders', widget)`.
   - `metrics` must include `{ label: 'Agent Vendor', value: 'OpenAI Codex' }`, total orders count, and cumulative revenue.
   - `html` must include a visible `'Built by Codex'` badge and a table/list of recent orders.
4. **`src/modules/orders/index.test.mjs`**:
   - Boot real isolated kernels via `createKernel({ dbPath: ':memory:' })` from `../../core/kernel.mjs`!
   - Test `orders` end-to-end (including verifying it succeeds via `ctx.services.billing.createInvoice` whether `billing` is still stub-mocked or active, and persists to `orders_records` + triggers `audit` event logging!).

---

## Task B (Assigned to OpenCode) — Billing & Invoice Ledger Module (`src/modules/billing/`)
- **Branch**: `feat/opencode-billing`
- **Exclusive Territory**: `src/modules/billing/**`
- **Test Command**: `node --test src/modules/billing/index.test.mjs`

### Requirements
1. **`src/modules/billing/schema.sql`**:
   Create table `billing_invoices`:
   ```sql
   CREATE TABLE IF NOT EXISTS billing_invoices (
     invoice_id TEXT PRIMARY KEY,
     order_id TEXT NOT NULL,
     customer TEXT NOT NULL,
     subtotal REAL NOT NULL,
     tax_rate REAL NOT NULL,
     tax_amount REAL NOT NULL,
     total_amount REAL NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   ```
2. **`src/modules/billing/index.mjs`**:
   - Set `implemented: true` (keep `id: 'billing'` and `order: 30` unchanged).
   - Implement `services.createInvoice(ctx, { orderId, customer, subtotal, taxRate = 0.08 })`:
     - Validate `orderId` (non-empty string), `customer` (non-empty string), finite `subtotal >= 0`, finite `taxRate >= 0`.
     - Compute `cleanSubtotal = roundCurrency(subtotal)`, `taxAmount = roundCurrency(cleanSubtotal * taxRate)`, `totalAmount = roundCurrency(cleanSubtotal + taxAmount)`.
     - Generate unique `invoiceId` (e.g. `'INV-' + Date.now() + '-' + Math.floor(Math.random() * 10000)`).
     - Insert row into `billing_invoices` with `status = 'PAID'` and ISO `created_at`.
     - Emit `ctx.bus.emit('invoice.created', { invoiceId, orderId, customer, subtotal: cleanSubtotal, taxRate, taxAmount, totalAmount, status: 'PAID' })`.
     - Return `{ invoiceId, orderId, customer, subtotal: cleanSubtotal, taxRate, taxAmount, totalAmount, status: 'PAID' }`.
   - Implement `services.listInvoices(ctx)` returning recent invoices ordered newest first (`{ invoiceId, orderId, customer, subtotal, taxRate, taxAmount, totalAmount, status, createdAt }`).
3. **`src/modules/billing/widget.mjs`**:
   - Export `renderWidget(ctx)` returning `{ slotId: 'billing', title: 'Billing & Invoice Ledger', badge, summary, metrics, html }`.
   - Must pass `validateWidgetOutput('billing', widget)`.
   - `metrics` must include `{ label: 'Agent Vendor', value: 'OpenCode' }`, total invoices count, and total billed amount (plus tax collected).
   - `html` must include a visible `'Built by OpenCode'` badge and an invoice ledger visualization.
4. **`src/modules/billing/index.test.mjs`**:
   - Boot real isolated kernels via `createKernel({ dbPath: ':memory:' })` from `../../core/kernel.mjs`!
   - Test `createInvoice`, `listInvoices`, tax rounding, input validation, `invoice.created` event emission (persisted by `audit`), and `renderWidget(ctx)`.
