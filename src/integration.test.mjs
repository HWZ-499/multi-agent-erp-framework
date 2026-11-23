import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from './core/kernel.mjs';
import { STUB_SERVICE_MOCKS } from './types/contracts.mjs';

async function boot(t) {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());
  return kernel;
}

test('Scenario 1: Normal order flow updates inventory, orders, billing, and audit consistently', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-LAPTOP');

  const order = await kernel.services.orders.createOrder({
    orderId: 'ORD-S1-001',
    sku: 'SKU-LAPTOP',
    qty: 2,
    customer: 'Normal Co',
    taxRate: 0.08,
  });

  assert.equal(order.status, 'CONFIRMED');
  assert.equal(order.mockedInventory, false);
  assert.equal(order.mockedBilling, false);
  assert.equal(order.subtotal, 2400);
  assert.equal(order.taxAmount, 192);
  assert.equal(order.totalAmount, 2592);

  const after = await kernel.services.inventory.getStock('SKU-LAPTOP');
  assert.equal(after.availableQty, before.availableQty - 2);
  assert.equal(after.reservedQty, before.reservedQty + 2);

  const orders = await kernel.services.orders.listOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderId, 'ORD-S1-001');

  const invoices = await kernel.services.billing.listInvoices();
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].orderId, 'ORD-S1-001');
  assert.equal(invoices[0].status, 'PAID');

  const logs = await kernel.services.audit.listLogs();
  const eventNames = logs.map((l) => l.eventName);
  assert.ok(eventNames.includes('inventory.reserved'));
  assert.ok(eventNames.includes('invoice.created'));
  assert.ok(eventNames.includes('order.created'));
});

test('Scenario 2: Insufficient inventory leaves orders, billing, and stock untouched', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-LAPTOP');

  await assert.rejects(
    () =>
      kernel.services.orders.createOrder({
        orderId: 'ORD-S2-001',
        sku: 'SKU-LAPTOP',
        qty: before.availableQty + 10,
        customer: 'Oversell Co',
      }),
    (err) => err?.statusCode === 409 || /Insufficient stock/i.test(err?.message || '')
  );

  assert.deepEqual(await kernel.services.inventory.getStock('SKU-LAPTOP'), before);
  assert.deepEqual(await kernel.services.orders.listOrders(), []);
  assert.deepEqual(await kernel.services.billing.listInvoices(), []);
});

test('Scenario 3 [P0]: Billing failure rolls back reserved inventory and cleans up order', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-MONITOR');

  t.mock.method(kernel.services.billing, 'createInvoice', async () => {
    throw new Error('Simulated billing failure');
  });

  await assert.rejects(
    () =>
      kernel.services.orders.createOrder({
        orderId: 'ORD-S3-ROLLBACK',
        sku: 'SKU-MONITOR',
        qty: 4,
        customer: 'Rollback Co',
      }),
    /Simulated billing failure/
  );

  assert.deepEqual(await kernel.services.orders.listOrders(), []);
  assert.deepEqual(await kernel.services.billing.listInvoices(), []);
  assert.deepEqual(await kernel.services.inventory.getStock('SKU-MONITOR'), before);

  const logs = await kernel.services.audit.listLogs();
  assert.ok(
    logs.some((l) => l.eventName === 'inventory.released'),
    'audit log must record compensating inventory.released event'
  );
});

test('Scenario 4 [P1]: Concurrent duplicate submission allows only one order, one invoice, and one stock deduction', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-DOCK');

  const results = await Promise.allSettled([
    kernel.services.orders.createOrder({
      orderId: 'ORD-RACE-1',
      sku: 'SKU-DOCK',
      qty: 3,
      customer: 'RaceCo',
    }),
    kernel.services.orders.createOrder({
      orderId: 'ORD-RACE-1',
      sku: 'SKU-DOCK',
      qty: 3,
      customer: 'RaceCo',
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one concurrent duplicate request should succeed');
  assert.equal(rejected.length, 1, 'duplicate concurrent request must be rejected');
  assert.equal(rejected[0].reason?.statusCode, 409);

  const after = await kernel.services.inventory.getStock('SKU-DOCK');
  assert.equal(after.availableQty, before.availableQty - 3);
  assert.equal(after.reservedQty, before.reservedQty + 3);

  assert.equal((await kernel.services.orders.listOrders()).length, 1);
  assert.equal((await kernel.services.billing.listInvoices()).length, 1);
});

test('Scenario 5 [P1]: Mocked downstream billing isolates real inventory side effects and sets PROVISIONAL_MOCK', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-DOCK');

  t.mock.method(kernel.services.billing, 'createInvoice', (req) =>
    STUB_SERVICE_MOCKS.billing.createInvoice(kernel.ctx, req)
  );

  const order = await kernel.services.orders.createOrder({
    orderId: 'ORD-S5-MOCK',
    sku: 'SKU-DOCK',
    qty: 2,
    customer: 'MockCheck Co',
  });

  assert.equal(order.mockedBilling, true);
  assert.equal(order.status, 'PROVISIONAL_MOCK');

  const orders = await kernel.services.orders.listOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'PROVISIONAL_MOCK');

  // Real inventory must remain completely untouched when downstream billing is mocked.
  assert.deepEqual(await kernel.services.inventory.getStock('SKU-DOCK'), before);
});

test('Scenario 6 [P0]: Post-billing failure voids invoice, releases inventory, and leaves zero orphaned records', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-LAPTOP');

  kernel.bus.on('order.created', () => {
    throw new Error('Simulated post-billing failure');
  });

  await assert.rejects(
    () =>
      kernel.services.orders.createOrder({
        orderId: 'ORD-S6-POSTFAIL',
        sku: 'SKU-LAPTOP',
        qty: 2,
        customer: 'OrphanGuard Co',
      }),
    /Simulated post-billing failure/
  );

  assert.deepEqual(await kernel.services.inventory.getStock('SKU-LAPTOP'), before);
  assert.deepEqual(await kernel.services.orders.listOrders(), []);
  assert.deepEqual(await kernel.services.billing.listInvoices(), []);

  const logs = await kernel.services.audit.listLogs();
  assert.ok(logs.some((l) => l.eventName === 'invoice.voided'));
  assert.ok(logs.some((l) => l.eventName === 'inventory.released'));
});

test('Scenario 7 [P1]: releaseStock is order-scoped and idempotent on repeated calls', async (t) => {
  const kernel = await boot(t);
  const initial = await kernel.services.inventory.getStock('SKU-DOCK');

  await kernel.services.inventory.reserveStock({ sku: 'SKU-DOCK', qty: 3, orderId: 'ORD-A' });
  await kernel.services.inventory.reserveStock({ sku: 'SKU-DOCK', qty: 3, orderId: 'ORD-B' });

  const firstRelease = await kernel.services.inventory.releaseStock({
    sku: 'SKU-DOCK',
    qty: 3,
    orderId: 'ORD-A',
  });
  assert.equal(firstRelease.released, true);

  const secondRelease = await kernel.services.inventory.releaseStock({
    sku: 'SKU-DOCK',
    qty: 3,
    orderId: 'ORD-A',
  });
  assert.equal(secondRelease.released, false);
  assert.equal(secondRelease.alreadyReleased, true);

  // ORD-B's 3 units must remain reserved and untouched.
  const after = await kernel.services.inventory.getStock('SKU-DOCK');
  assert.equal(after.availableQty, initial.availableQty - 3);
  assert.equal(after.reservedQty, initial.reservedQty + 3);

  await assert.rejects(
    () => kernel.services.inventory.releaseStock({ sku: 'SKU-DOCK', qty: 3, orderId: 'ORD-NEVER-RESERVED' }),
    (err) => err?.statusCode === 404 || err?.statusCode === 409
  );
});

test('Scenario 8: Compensation failure is surfaced and order is marked COMPENSATION_FAILED instead of deleted', async (t) => {
  const kernel = await boot(t);

  t.mock.method(kernel.services.billing, 'createInvoice', async () => {
    throw new Error('Billing crashed');
  });
  t.mock.method(kernel.services.inventory, 'releaseStock', async () => {
    throw new Error('Inventory release crashed');
  });

  await assert.rejects(
    () =>
      kernel.services.orders.createOrder({
        orderId: 'ORD-S8-COMPFAIL',
        sku: 'SKU-DOCK',
        qty: 2,
        customer: 'CompFail Co',
      }),
    (err) =>
      /Billing crashed/.test(err?.message || '') &&
      /compensation failed/i.test(err?.message || '') &&
      Array.isArray(err?.compensationErrors) &&
      err.compensationErrors.length === 1
  );

  const rawRow = kernel.db
    .prepare('SELECT order_id, status FROM orders_records WHERE order_id = ?')
    .get('ORD-S8-COMPFAIL');
  assert.equal(rawRow?.status, 'COMPENSATION_FAILED');
  assert.deepEqual(await kernel.services.orders.listOrders(), []);
});
