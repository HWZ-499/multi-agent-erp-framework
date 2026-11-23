import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from '../../core/kernel.mjs';
import { validateWidgetOutput } from '../../types/contracts.mjs';
import { renderWidget } from './widget.mjs';

test('inventory module boots ACTIVE and seeds initial SKUs idempotently', async () => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  try {
    assert.equal(kernel.ctx.slotStatus.inventory, 'ACTIVE');

    const items = await kernel.services.inventory.listItems();
    assert.deepEqual(items, [
      {
        sku: 'SKU-DOCK',
        name: 'Thunderbolt Dock',
        availableQty: 50,
        reservedQty: 0,
        unitPrice: 150,
      },
      {
        sku: 'SKU-LAPTOP',
        name: 'Pro Laptop 16"',
        availableQty: 15,
        reservedQty: 0,
        unitPrice: 1200,
      },
      {
        sku: 'SKU-MONITOR',
        name: '4K Studio Monitor',
        availableQty: 30,
        reservedQty: 0,
        unitPrice: 350,
      },
    ]);

    await kernel.services.inventory.reserveStock({
      sku: 'SKU-LAPTOP',
      qty: 2,
      orderId: 'ORD-SEED-CHECK',
    });

    // Re-running init must preserve modified quantities via INSERT OR IGNORE
    await kernel.modules.get('inventory').init(kernel.ctx);

    const laptop = await kernel.services.inventory.getStock('SKU-LAPTOP');
    assert.equal(laptop.availableQty, 13);
    assert.equal(laptop.reservedQty, 2);
  } finally {
    kernel.close();
  }
});

test('getStock returns SKU details and throws for missing or invalid SKU', async () => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  try {
    const monitor = await kernel.services.inventory.getStock('SKU-MONITOR');
    assert.deepEqual(monitor, {
      sku: 'SKU-MONITOR',
      name: '4K Studio Monitor',
      availableQty: 30,
      reservedQty: 0,
      unitPrice: 350,
    });

    await assert.rejects(
      () => kernel.services.inventory.getStock('SKU-MISSING'),
      /not found/i
    );
    await assert.rejects(() => kernel.services.inventory.getStock(''), /non-empty string/i);
    await assert.rejects(() => kernel.services.inventory.getStock(null), /non-empty string/i);
  } finally {
    kernel.close();
  }
});

test('reserveStock updates balances, emits inventory.reserved, and rejects insufficient stock or invalid inputs', async () => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  try {
    const events = [];
    kernel.bus.on('inventory.reserved', (payload) => events.push(payload));

    const reservation = await kernel.services.inventory.reserveStock({
      sku: 'SKU-LAPTOP',
      qty: 4,
      orderId: 'ORD-1001',
    });

    assert.deepEqual(reservation, {
      reserved: true,
      sku: 'SKU-LAPTOP',
      qty: 4,
      remainingQty: 11,
      unitPrice: 1200,
      orderId: 'ORD-1001',
    });

    assert.deepEqual(events, [
      {
        sku: 'SKU-LAPTOP',
        qty: 4,
        remainingQty: 11,
        unitPrice: 1200,
        orderId: 'ORD-1001',
      },
    ]);

    const afterSuccess = await kernel.services.inventory.getStock('SKU-LAPTOP');
    assert.equal(afterSuccess.availableQty, 11);
    assert.equal(afterSuccess.reservedQty, 4);

    // Insufficient stock error must reject without modifying DB or emitting event
    await assert.rejects(
      () =>
        kernel.services.inventory.reserveStock({
          sku: 'SKU-LAPTOP',
          qty: 12,
          orderId: 'ORD-1002',
        }),
      /insufficient stock/i
    );

    const afterFailure = await kernel.services.inventory.getStock('SKU-LAPTOP');
    assert.equal(afterFailure.availableQty, 11);
    assert.equal(afterFailure.reservedQty, 4);
    assert.equal(events.length, 1);

    // Missing SKU & invalid input checks
    await assert.rejects(
      () => kernel.services.inventory.reserveStock({ sku: 'SKU-NOPE', qty: 1, orderId: 'ORD-1003' }),
      /not found/i
    );
    await assert.rejects(
      () => kernel.services.inventory.reserveStock({ sku: '  ', qty: 1, orderId: 'ORD-1004' }),
      /non-empty string/i
    );
    await assert.rejects(
      () => kernel.services.inventory.reserveStock({ sku: 'SKU-LAPTOP', qty: 0, orderId: 'ORD-1005' }),
      /positive integer/i
    );
    await assert.rejects(
      () => kernel.services.inventory.reserveStock({ sku: 'SKU-LAPTOP', qty: -3, orderId: 'ORD-1006' }),
      /positive integer/i
    );
    await assert.rejects(
      () => kernel.services.inventory.reserveStock({ sku: 'SKU-LAPTOP', qty: 1.5, orderId: 'ORD-1007' }),
      /positive integer/i
    );
    await assert.rejects(
      () => kernel.services.inventory.reserveStock({ sku: 'SKU-LAPTOP', qty: '2', orderId: 'ORD-1008' }),
      /positive integer/i
    );
  } finally {
    kernel.close();
  }
});

test('restock adds available units, emits inventory.restocked, and validates inputs', async () => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  try {
    const events = [];
    kernel.bus.on('inventory.restocked', (payload) => events.push(payload));

    const result = await kernel.services.inventory.restock({
      sku: 'SKU-DOCK',
      qty: 10,
    });

    assert.deepEqual(result, {
      sku: 'SKU-DOCK',
      availableQty: 60,
    });

    assert.deepEqual(events, [
      {
        sku: 'SKU-DOCK',
        qty: 10,
        availableQty: 60,
      },
    ]);

    const dock = await kernel.services.inventory.getStock('SKU-DOCK');
    assert.equal(dock.availableQty, 60);
    assert.equal(dock.reservedQty, 0);

    await assert.rejects(
      () => kernel.services.inventory.restock({ sku: 'SKU-UNKNOWN', qty: 5 }),
      /not found/i
    );
    await assert.rejects(
      () => kernel.services.inventory.restock({ sku: '', qty: 5 }),
      /non-empty string/i
    );
    await assert.rejects(
      () => kernel.services.inventory.restock({ sku: 'SKU-DOCK', qty: 0 }),
      /positive integer/i
    );
    await assert.rejects(
      () => kernel.services.inventory.restock({ sku: 'SKU-DOCK', qty: 2.5 }),
      /positive integer/i
    );
    assert.equal(events.length, 1);
  } finally {
    kernel.close();
  }
});

test('renderWidget produces valid dark-theme widget output reflecting live stock', async () => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  try {
    await kernel.services.inventory.reserveStock({
      sku: 'SKU-LAPTOP',
      qty: 3,
      orderId: 'ORD-WIDGET-1',
    });
    await kernel.services.inventory.restock({
      sku: 'SKU-DOCK',
      qty: 5,
    });

    const widget = renderWidget(kernel.ctx);
    validateWidgetOutput('inventory', widget);

    assert.equal(widget.slotId, 'inventory');
    assert.equal(widget.title, 'Inventory & Stock Ledger');

    const metricMap = new Map(widget.metrics.map((m) => [m.label, m.value]));
    assert.equal(metricMap.get('Total SKUs'), '3');
    assert.equal(metricMap.get('Available Units'), '97'); // (15-3) + 30 + (50+5)
    assert.equal(metricMap.get('Reserved Units'), '3');
    assert.equal(metricMap.get('Agent Owner'), 'Agent-Inventory');

    assert.match(widget.html, /<table\b/i);
    assert.match(widget.html, /SKU-DOCK/);
    assert.match(widget.html, /SKU-LAPTOP/);
    assert.match(widget.html, /SKU-MONITOR/);
    assert.match(widget.html, /Thunderbolt Dock/);
    assert.match(widget.html, /4K Studio Monitor/);
    assert.match(widget.html, /1200\.00/);
    assert.match(widget.html, /350\.00/);
    assert.match(widget.html, /150\.00/);

    const dashboard = await kernel.getDashboard();
    const slot = dashboard.slots.find((s) => s.slotId === 'inventory');
    assert.ok(slot);
    assert.equal(slot.status, 'ACTIVE');
    assert.equal(slot.title, 'Inventory & Stock Ledger');
  } finally {
    kernel.close();
  }
});
