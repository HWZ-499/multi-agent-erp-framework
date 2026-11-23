import { roundCurrency } from '../../types/contracts.mjs';

const SEED_ITEMS = [
  ['SKU-LAPTOP', 'Pro Laptop 16"', 15, 0, 1200],
  ['SKU-MONITOR', '4K Studio Monitor', 30, 0, 350],
  ['SKU-DOCK', 'Thunderbolt Dock', 50, 0, 150],
];

/**
 * Validates and normalizes a SKU identifier.
 * @param {unknown} sku
 * @returns {string}
 */
function validateSku(sku) {
  if (typeof sku !== 'string' || sku.trim().length === 0) {
    throw new Error('Invalid SKU: sku must be a non-empty string');
  }
  return sku.trim();
}

/**
 * Validates that a quantity is a positive integer.
 * @param {unknown} qty
 * @returns {number}
 */
function validatePositiveQty(qty) {
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) {
    throw new Error('Invalid quantity: qty must be a positive integer');
  }
  return qty;
}

/**
 * Maps a raw `inventory_items` SQLite row to the service contract DTO.
 * @param {{ sku: string, name: string, available_qty: number, reserved_qty: number, unit_price: number }} row
 */
function mapItemRow(row) {
  return {
    sku: row.sku,
    name: row.name,
    availableQty: row.available_qty,
    reservedQty: row.reserved_qty,
    unitPrice: roundCurrency(row.unit_price),
  };
}

/**
 * Fetches an inventory row by SKU or throws a 404 Error if missing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sku
 */
function findItemRowOrThrow(db, sku) {
  const row = db
    .prepare(
      'SELECT sku, name, available_qty, reserved_qty, unit_price FROM inventory_items WHERE sku = ?'
    )
    .get(sku);

  if (!row) {
    const err = new Error(`SKU "${sku}" not found in inventory`);
    err.statusCode = 404;
    throw err;
  }

  return row;
}

/**
 * SLOT 1: Inventory Module (Assigned to Agent-Inventory)
 */
export const moduleDef = {
  id: 'inventory',
  order: 10,
  implemented: true,

  init(ctx) {
    const stmt = ctx.db.prepare(
      'INSERT OR IGNORE INTO inventory_items (sku, name, available_qty, reserved_qty, unit_price) VALUES (?, ?, ?, ?, ?)'
    );
    for (const item of SEED_ITEMS) {
      stmt.run(...item);
    }
  },

  services: {
    listItems(ctx) {
      const rows = ctx.db
        .prepare(
          'SELECT sku, name, available_qty, reserved_qty, unit_price FROM inventory_items ORDER BY sku ASC'
        )
        .all();
      return rows.map(mapItemRow);
    },

    getStock(ctx, sku) {
      const cleanSku = validateSku(sku);
      const row = findItemRowOrThrow(ctx.db, cleanSku);
      return mapItemRow(row);
    },

    reserveStock(ctx, input = {}) {
      const params = input && typeof input === 'object' ? input : {};
      const sku = validateSku(params.sku);
      const qty = validatePositiveQty(params.qty);
      const orderId = params.orderId ?? null;

      const existing = findItemRowOrThrow(ctx.db, sku);
      if (existing.available_qty < qty) {
        const err = new Error(
          `Insufficient stock for "${sku}": requested ${qty}, available ${existing.available_qty}`
        );
        err.statusCode = 409;
        throw err;
      }

      const info = ctx.db
        .prepare(
          'UPDATE inventory_items SET available_qty = available_qty - ?, reserved_qty = reserved_qty + ? WHERE sku = ? AND available_qty >= ?'
        )
        .run(qty, qty, sku, qty);

      if (info.changes !== 1) {
        throw new Error(`Failed to reserve stock for "${sku}"`);
      }

      const updated = findItemRowOrThrow(ctx.db, sku);
      const remainingQty = updated.available_qty;
      const unitPrice = roundCurrency(updated.unit_price);

      ctx.bus.emit('inventory.reserved', {
        sku,
        qty,
        remainingQty,
        unitPrice,
        orderId,
      });

      return {
        reserved: true,
        sku,
        qty,
        remainingQty,
        unitPrice,
        orderId,
      };
    },

    restock(ctx, input = {}) {
      const params = input && typeof input === 'object' ? input : {};
      const sku = validateSku(params.sku);
      const qty = validatePositiveQty(params.qty);

      findItemRowOrThrow(ctx.db, sku);

      ctx.db
        .prepare('UPDATE inventory_items SET available_qty = available_qty + ? WHERE sku = ?')
        .run(qty, sku);

      const updated = findItemRowOrThrow(ctx.db, sku);
      const availableQty = updated.available_qty;

      ctx.bus.emit('inventory.restocked', {
        sku,
        qty,
        availableQty,
      });

      return {
        sku,
        availableQty,
      };
    },
  },

  routes: {
    getStock(ctx, { query }) {
      return ctx.services.inventory.getStock(query?.sku);
    },
  },
};
