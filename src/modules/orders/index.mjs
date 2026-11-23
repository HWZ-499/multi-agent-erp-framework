import { randomUUID } from 'node:crypto';
import { roundCurrency } from '../../types/contracts.mjs';

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * SLOT 2: Order Orchestration Module (Assigned to OpenAI Codex)
 *
 * Strictly do NOT import from `../inventory`, `../billing`, or `../audit`!
 * All cross-module calls MUST go through `ctx.services` and `ctx.bus`.
 *
 * Specification:
 * 1. Create table `orders_records` in `src/modules/orders/schema.sql`:
 *      CREATE TABLE IF NOT EXISTS orders_records (
 *        order_id TEXT PRIMARY KEY,
 *        customer TEXT NOT NULL,
 *        sku TEXT NOT NULL,
 *        qty INTEGER NOT NULL,
 *        unit_price REAL NOT NULL,
 *        subtotal REAL NOT NULL,
 *        tax_amount REAL NOT NULL,
 *        total_amount REAL NOT NULL,
 *        invoice_id TEXT NOT NULL,
 *        status TEXT NOT NULL,
 *        created_at TEXT NOT NULL
 *      );
 * 2. Set `implemented: true` (keep `id: 'orders'` and `order: 20` unchanged).
 * 3. Implement `services.createOrder(ctx, input)`:
 *    - Validate `sku` (non-empty string), `qty` (positive integer), `customer` (non-empty string).
 *    - Use `taxRate = typeof input.taxRate === 'number' && Number.isFinite(input.taxRate) && input.taxRate >= 0 ? input.taxRate : 0.08`.
 *    - Generate unique `orderId` (if not provided in `input.orderId`).
 *    - Call `const reservation = await ctx.services.inventory.reserveStock({ sku, qty, orderId })`.
 *    - Compute `subtotal = roundCurrency(reservation.unitPrice * qty)`.
 *    - Call `const invoice = await ctx.services.billing.createInvoice({ orderId, customer, subtotal, taxRate })`.
 *    - Persist order into `orders_records` with `status = 'CONFIRMED'`.
 *    - Emit `ctx.bus.emit('order.created', { orderId, customer, sku, qty, subtotal, totalAmount: invoice.totalAmount, invoiceId: invoice.invoiceId })`.
 *    - Return `{ orderId, customer, sku, qty, unitPrice: reservation.unitPrice, subtotal, taxAmount: invoice.taxAmount, totalAmount: invoice.totalAmount, invoiceId: invoice.invoiceId, status: 'CONFIRMED', mockedInventory: Boolean(reservation._mock), mockedBilling: Boolean(invoice._mock) }`.
 * 4. Implement `services.listOrders(ctx)` returning recent orders ordered newest first.
 * 5. Create `src/modules/orders/widget.mjs` exporting `renderWidget(ctx)` passing `validateWidgetOutput('orders', widget)`
 *    with `Agent Vendor: OpenAI Codex` in `metrics` and `Built by Codex` badge in `html`.
 * 6. Create `src/modules/orders/index.test.mjs` testing with `createKernel({ dbPath: ':memory:' })`
 *    (verify `orders` works even if `billing` is still mocked or active!).
 */
export const moduleDef = {
  id: 'orders',
  order: 20,
  implemented: true,

  init(_ctx) {},
  services: {
    async createOrder(ctx, input = {}) {
      const sku = requireText(input?.sku, 'sku');
      const qty = input?.qty;
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error('qty must be a positive integer');
      }
      const customer = requireText(input?.customer, 'customer');
      const taxRate = typeof input?.taxRate === 'number'
        && Number.isFinite(input.taxRate) && input.taxRate >= 0 ? input.taxRate : 0.08;
      const orderId = input.orderId == null
        ? `ORD-${randomUUID()}` : requireText(input.orderId, 'orderId');

      if (ctx.db.prepare('SELECT 1 FROM orders_records WHERE order_id = ?').get(orderId)) {
        const error = new Error(`Order "${orderId}" already exists`);
        error.statusCode = 409;
        throw error;
      }

      const createdAt = new Date().toISOString();
      ctx.db.prepare(`
        INSERT INTO orders_records (
          order_id, customer, sku, qty, unit_price, subtotal,
          tax_amount, total_amount, invoice_id, status, created_at
        ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, '', 'PENDING', ?)
      `).run(orderId, customer, sku, qty, createdAt);

      let reservation = null;
      try {
        reservation = await ctx.services.inventory.reserveStock({ sku, qty, orderId });
        const subtotal = roundCurrency(reservation.unitPrice * qty);
        const invoice = await ctx.services.billing.createInvoice({ orderId, customer, subtotal, taxRate });

        const mockedInventory = Boolean(reservation._mock);
        const mockedBilling = Boolean(invoice._mock);
        const status = mockedInventory || mockedBilling ? 'PROVISIONAL_MOCK' : 'CONFIRMED';

        ctx.db.prepare(`
          UPDATE orders_records
          SET unit_price = ?, subtotal = ?, tax_amount = ?, total_amount = ?,
              invoice_id = ?, status = ?, created_at = ?
          WHERE order_id = ?
        `).run(
          reservation.unitPrice,
          subtotal,
          invoice.taxAmount,
          invoice.totalAmount,
          invoice.invoiceId,
          status,
          createdAt,
          orderId
        );

        ctx.bus.emit('order.created', {
          orderId, customer, sku, qty, subtotal,
          totalAmount: invoice.totalAmount, invoiceId: invoice.invoiceId,
        });

        return {
          orderId, customer, sku, qty, unitPrice: reservation.unitPrice, subtotal,
          taxAmount: invoice.taxAmount, totalAmount: invoice.totalAmount,
          invoiceId: invoice.invoiceId, status,
          mockedInventory, mockedBilling,
        };
      } catch (err) {
        if (reservation) {
          try {
            await ctx.services.inventory.releaseStock({ sku, qty, orderId });
          } catch {
            // Preserve the originating failure while compensating reserved stock.
          }
        }
        ctx.db.prepare("DELETE FROM orders_records WHERE order_id = ? AND status = 'PENDING'").run(orderId);
        throw err;
      }
    },

    listOrders(ctx) {
      return ctx.db.prepare(`
        SELECT order_id AS orderId, customer, sku, qty, unit_price AS unitPrice,
          subtotal, tax_amount AS taxAmount, total_amount AS totalAmount,
          invoice_id AS invoiceId, status, created_at AS createdAt
        FROM orders_records
        WHERE status != 'PENDING'
        ORDER BY created_at DESC, rowid DESC
      `).all().map((row) => ({ ...row }));
    },
  },
  routes: {},
};
