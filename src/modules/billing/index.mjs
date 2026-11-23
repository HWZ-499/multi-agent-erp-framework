import { roundCurrency } from '../../types/contracts.mjs';

/**
 * SLOT 3: Billing & Invoice Ledger Module (Assigned to OpenCode)
 *
 * Strictly do NOT import from `../inventory`, `../orders`, or `../audit`!
 * All cross-module calls MUST go through `ctx.services` and `ctx.bus`.
 *
 * Specification:
 * 1. Create table `billing_invoices` in `src/modules/billing/schema.sql`:
 *      CREATE TABLE IF NOT EXISTS billing_invoices (
 *        invoice_id TEXT PRIMARY KEY,
 *        order_id TEXT NOT NULL,
 *        customer TEXT NOT NULL,
 *        subtotal REAL NOT NULL,
 *        tax_rate REAL NOT NULL,
 *        tax_amount REAL NOT NULL,
 *        total_amount REAL NOT NULL,
 *        status TEXT NOT NULL,
 *        created_at TEXT NOT NULL
 *      );
 * 2. Set `implemented: true` (keep `id: 'billing'` and `order: 30` unchanged).
 * 3. Implement `services.createInvoice(ctx, { orderId, customer, subtotal, taxRate = 0.08 })`:
 *    - Validate `orderId` (non-empty string), `customer` (non-empty string), `subtotal >= 0`, `taxRate >= 0`.
 *    - Compute `cleanSubtotal = roundCurrency(subtotal)`, `taxAmount = roundCurrency(cleanSubtotal * taxRate)`, `totalAmount = roundCurrency(cleanSubtotal + taxAmount)`.
 *    - Generate unique `invoiceId` (e.g. `INV-${Date.now()}-${...}`).
 *    - Persist into `billing_invoices` with `status = 'PAID'`.
 *    - Emit `ctx.bus.emit('invoice.created', { invoiceId, orderId, customer, subtotal: cleanSubtotal, taxRate, taxAmount, totalAmount, status: 'PAID' })`.
 *    - Return `{ invoiceId, orderId, customer, subtotal: cleanSubtotal, taxRate, taxAmount, totalAmount, status: 'PAID' }`.
 * 4. Implement `services.listInvoices(ctx)` returning recent invoices ordered newest first.
 * 5. Create `src/modules/billing/widget.mjs` exporting `renderWidget(ctx)` passing `validateWidgetOutput('billing', widget)`
 *    with `Agent Vendor: OpenCode` in `metrics` and `Built by OpenCode` badge in `html`.
 * 6. Create `src/modules/billing/index.test.mjs` testing with `createKernel({ dbPath: ':memory:' })`.
 */
export const moduleDef = {
  id: 'billing',
  order: 30,
  implemented: false,

  init(_ctx) {},
  services: {},
  routes: {},
};

void roundCurrency;
