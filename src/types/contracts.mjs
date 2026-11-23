/**
 * Frozen Service & Widget Contracts + Kernel Stub Auto-Mocks.
 * DO NOT MODIFY THIS FILE IN FEATURE BRANCHES.
 */

export const VALID_SLOTS = ['inventory', 'orders', 'billing', 'audit'];

const VALID_SLOT_SET = new Set(VALID_SLOTS);

/**
 * Rounds a number to 2 decimal places for USD currency values.
 * @param {number} val
 * @returns {number}
 */
export function roundCurrency(val) {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new TypeError(`roundCurrency expected a finite number, got: ${val}`);
  }
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Validates that a module's UI widget conforms to the frozen dashboard contract.
 * @param {string} slotId
 * @param {object} widget
 */
export function validateWidgetOutput(slotId, widget) {
  if (!VALID_SLOT_SET.has(slotId)) {
    throw new Error(`Unknown slotId "${slotId}". Expected one of: ${VALID_SLOTS.join(', ')}`);
  }

  if (!widget || typeof widget !== 'object' || Array.isArray(widget)) {
    throw new TypeError(`Widget output for "${slotId}" must be a non-null plain object`);
  }

  if (typeof widget.slotId !== 'string' || widget.slotId !== slotId) {
    throw new Error(`Widget slotId "${widget.slotId}" must match "${slotId}"`);
  }

  for (const field of ['title', 'badge', 'summary', 'html']) {
    if (typeof widget[field] !== 'string' || widget[field].trim().length === 0) {
      throw new Error(`Widget "${slotId}" field "${field}" must be a non-empty string`);
    }
  }

  if (!Array.isArray(widget.metrics) || widget.metrics.length < 2) {
    throw new Error(`Widget "${slotId}" must include a metrics array with at least 2 items`);
  }

  for (const [idx, item] of widget.metrics.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`Widget "${slotId}" metric[${idx}] must be a plain object`);
    }
    if (typeof item.label !== 'string' || item.label.trim().length === 0) {
      throw new Error(`Widget "${slotId}" metric[${idx}].label must be a non-empty string`);
    }
    if (typeof item.value !== 'string' || item.value.trim().length === 0) {
      throw new Error(`Widget "${slotId}" metric[${idx}].value must be a non-empty string`);
    }
  }

  return widget;
}

const MOCK_PRICES = {
  'SKU-LAPTOP': 1200,
  'SKU-MONITOR': 350,
  'SKU-DOCK': 150,
};

/**
 * Deterministic fallback mocks used automatically by the Kernel Service Bus
 * whenever a target module is still in `implemented: false` ([STUB]) state.
 */
export const STUB_SERVICE_MOCKS = {
  inventory: {
    listItems(_ctx) {
      return [
        { sku: 'SKU-LAPTOP', name: 'Pro Laptop 16"', availableQty: 25, reservedQty: 0, unitPrice: 1200, _mock: true },
        { sku: 'SKU-MONITOR', name: '4K Studio Monitor', availableQty: 30, reservedQty: 0, unitPrice: 350, _mock: true },
        { sku: 'SKU-DOCK', name: 'Thunderbolt Dock', availableQty: 50, reservedQty: 0, unitPrice: 150, _mock: true },
      ];
    },
    getStock(_ctx, sku) {
      const unitPrice = MOCK_PRICES[sku] ?? 100;
      return { sku, name: `Mock ${sku}`, availableQty: 50, reservedQty: 0, unitPrice, _mock: true };
    },
    reserveStock(_ctx, { sku = 'SKU-LAPTOP', qty = 1, orderId = 'ORD-MOCK' } = {}) {
      const unitPrice = MOCK_PRICES[sku] ?? 100;
      return {
        reserved: true,
        sku,
        qty,
        remainingQty: Math.max(0, 50 - qty),
        unitPrice,
        orderId,
        _mock: true,
      };
    },
    restock(_ctx, { sku = 'SKU-LAPTOP', qty = 5 } = {}) {
      return { sku, availableQty: 50 + qty, _mock: true };
    },
    releaseStock(_ctx, { sku = 'SKU-LAPTOP', qty = 1, orderId = 'ORD-MOCK' } = {}) {
      return {
        released: true,
        sku,
        qty,
        remainingQty: 50,
        orderId,
        _mock: true,
      };
    },
  },

  billing: {
    createInvoice(_ctx, { orderId = 'ORD-MOCK-001', customer = 'Demo Customer', subtotal = 0, taxRate = 0.08 } = {}) {
      const cleanSubtotal = roundCurrency(Number(subtotal) || 0);
      const taxAmount = roundCurrency(cleanSubtotal * taxRate);
      const totalAmount = roundCurrency(cleanSubtotal + taxAmount);
      return {
        invoiceId: `INV-MOCK-${String(orderId).slice(-4)}`,
        orderId,
        customer,
        subtotal: cleanSubtotal,
        taxRate,
        taxAmount,
        totalAmount,
        status: 'PAID',
        _mock: true,
      };
    },
    listInvoices(_ctx) {
      return [];
    },
    voidInvoice(_ctx, { invoiceId = 'INV-MOCK-001', orderId = 'ORD-MOCK-001' } = {}) {
      return {
        voided: true,
        invoiceId,
        orderId,
        status: 'VOIDED',
        _mock: true,
      };
    },
  },

  orders: {
    async createOrder(ctx, input = {}) {
      const sku = typeof input.sku === 'string' && input.sku.trim() ? input.sku.trim() : 'SKU-LAPTOP';
      const qty = Number.isInteger(Number(input.qty)) && Number(input.qty) > 0 ? Number(input.qty) : 1;
      const customer = typeof input.customer === 'string' && input.customer.trim() ? input.customer.trim() : 'Demo Customer';
      const taxRate = typeof input.taxRate === 'number' && Number.isFinite(input.taxRate) ? input.taxRate : 0.08;
      const orderId = input.orderId || `ORD-MOCK-${Date.now().toString().slice(-4)}`;

      const reservation = await ctx.services.inventory.reserveStock({ sku, qty, orderId });
      const subtotal = roundCurrency(reservation.unitPrice * qty);
      const invoice = await ctx.services.billing.createInvoice({ orderId, customer, subtotal, taxRate });

      ctx.bus.emit('order.created', {
        orderId,
        customer,
        sku,
        qty,
        subtotal,
        totalAmount: invoice.totalAmount,
        _mock: true,
      });

      return {
        orderId,
        customer,
        sku,
        qty,
        unitPrice: reservation.unitPrice,
        subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        invoiceId: invoice.invoiceId,
        status: 'CONFIRMED',
        _mock: true,
      };
    },
    listOrders(_ctx) {
      return [];
    },
  },

  audit: {
    record(_ctx, entry = {}) {
      return { id: 0, ...entry, _mock: true };
    },
    listLogs(_ctx) {
      return [];
    },
  },
};
