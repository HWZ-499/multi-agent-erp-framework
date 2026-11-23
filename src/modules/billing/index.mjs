import { roundCurrency } from '../../types/contracts.mjs';

const DEFAULT_TAX_RATE = 0.08;
const INVOICE_STATUS = 'PAID';

/** Monotonic suffix guaranteeing invoiceId uniqueness within the same millisecond. */
let invoiceSequence = 0;

/**
 * Validates and normalizes a required non-empty string identifier.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function validateNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${field}: ${field} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Validates a monetary subtotal (finite and >= 0).
 * @param {unknown} subtotal
 * @returns {number}
 */
function validateSubtotal(subtotal) {
  if (typeof subtotal !== 'number' || !Number.isFinite(subtotal) || subtotal < 0) {
    throw new Error('Invalid subtotal: subtotal must be a finite number >= 0');
  }
  return subtotal;
}

/**
 * Validates a tax rate expressed as a decimal fraction (finite and >= 0).
 * @param {unknown} taxRate
 * @returns {number}
 */
function validateTaxRate(taxRate) {
  if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate < 0) {
    throw new Error('Invalid taxRate: taxRate must be a finite number >= 0');
  }
  return taxRate;
}

/**
 * Generates a unique invoice identifier without relying on other modules.
 * @returns {string}
 */
function generateInvoiceId() {
  invoiceSequence += 1;
  const randomSuffix = Math.floor(Math.random() * 10000);
  return `INV-${Date.now()}-${invoiceSequence}-${randomSuffix}`;
}

/**
 * Maps a raw `billing_invoices` SQLite row to the service contract DTO.
 * @param {{ invoice_id: string, order_id: string, customer: string, subtotal: number, tax_rate: number, tax_amount: number, total_amount: number, status: string, created_at: string }} row
 */
function mapInvoiceRow(row) {
  return {
    invoiceId: row.invoice_id,
    orderId: row.order_id,
    customer: row.customer,
    subtotal: roundCurrency(row.subtotal),
    taxRate: row.tax_rate,
    taxAmount: roundCurrency(row.tax_amount),
    totalAmount: roundCurrency(row.total_amount),
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * SLOT 3: Billing & Invoice Ledger Module (Assigned to OpenCode)
 *
 * Strictly do NOT import from `../inventory`, `../orders`, or `../audit`!
 * All cross-module calls MUST go through `ctx.services` and `ctx.bus`.
 */
export const moduleDef = {
  id: 'billing',
  order: 30,
  implemented: true,

  init(_ctx) {},

  services: {
    /**
     * Creates a PAID invoice, persists it into `billing_invoices`, and publishes
     * the `invoice.created` event on the kernel Event Bus.
     *
     * @param {{ db: import('node:sqlite').DatabaseSync, bus: { emit: (event: string, payload: object) => void } }} ctx
     * @param {{ orderId?: unknown, customer?: unknown, subtotal?: unknown, taxRate?: number }} [input]
     */
    createInvoice(ctx, input = {}) {
      const params = input && typeof input === 'object' ? input : {};
      const orderId = validateNonEmptyString(params.orderId, 'orderId');
      const customer = validateNonEmptyString(params.customer, 'customer');
      const subtotal = validateSubtotal(params.subtotal);
      const taxRate =
        params.taxRate === undefined ? DEFAULT_TAX_RATE : validateTaxRate(params.taxRate);

      const cleanSubtotal = roundCurrency(subtotal);
      const taxAmount = roundCurrency(cleanSubtotal * taxRate);
      const totalAmount = roundCurrency(cleanSubtotal + taxAmount);
      const invoiceId = generateInvoiceId();
      const createdAt = new Date().toISOString();

      const result = ctx.db
        .prepare(
          'INSERT INTO billing_invoices (invoice_id, order_id, customer, subtotal, tax_rate, tax_amount, total_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          invoiceId,
          orderId,
          customer,
          cleanSubtotal,
          taxRate,
          taxAmount,
          totalAmount,
          INVOICE_STATUS,
          createdAt
        );

      if (result.changes !== 1) {
        throw new Error(`Failed to persist invoice "${invoiceId}"`);
      }

      ctx.bus.emit('invoice.created', {
        invoiceId,
        orderId,
        customer,
        subtotal: cleanSubtotal,
        taxRate,
        taxAmount,
        totalAmount,
        status: INVOICE_STATUS,
      });

      return {
        invoiceId,
        orderId,
        customer,
        subtotal: cleanSubtotal,
        taxRate,
        taxAmount,
        totalAmount,
        status: INVOICE_STATUS,
      };
    },

    /**
     * Lists persisted invoices, newest first.
     * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
     */
    listInvoices(ctx) {
      const rows = ctx.db
        .prepare(
          'SELECT invoice_id, order_id, customer, subtotal, tax_rate, tax_amount, total_amount, status, created_at FROM billing_invoices ORDER BY created_at DESC, rowid DESC'
        )
        .all();

      return rows.map(mapInvoiceRow);
    },

    /**
     * Voids (removes) a persisted invoice during compensating Saga rollback
     * and emits `invoice.voided`. Idempotent when already voided.
     */
    voidInvoice(ctx, input = {}) {
      const params = input && typeof input === 'object' ? input : {};
      const cleanInvoiceId =
        typeof params.invoiceId === 'string' && params.invoiceId.trim().length > 0
          ? params.invoiceId.trim()
          : null;
      const cleanOrderId =
        typeof params.orderId === 'string' && params.orderId.trim().length > 0
          ? params.orderId.trim()
          : null;

      if (!cleanInvoiceId && !cleanOrderId) {
        throw new Error('Invalid voidInvoice request: invoiceId or orderId is required');
      }

      const row = cleanInvoiceId
        ? ctx.db
            .prepare('SELECT invoice_id, order_id FROM billing_invoices WHERE invoice_id = ?')
            .get(cleanInvoiceId)
        : ctx.db
            .prepare('SELECT invoice_id, order_id FROM billing_invoices WHERE order_id = ?')
            .get(cleanOrderId);

      if (!row) {
        return {
          voided: false,
          alreadyVoided: true,
          invoiceId: cleanInvoiceId,
          orderId: cleanOrderId,
          status: 'VOIDED',
        };
      }

      ctx.db.prepare('DELETE FROM billing_invoices WHERE invoice_id = ?').run(row.invoice_id);

      ctx.bus.emit('invoice.voided', {
        invoiceId: row.invoice_id,
        orderId: row.order_id,
        status: 'VOIDED',
      });

      return {
        voided: true,
        invoiceId: row.invoice_id,
        orderId: row.order_id,
        status: 'VOIDED',
      };
    },
  },

  routes: {},
};
