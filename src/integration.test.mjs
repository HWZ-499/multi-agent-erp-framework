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

test('Scenario 5 [P0]: Mocked downstream billing creates PROVISIONAL_MOCK order instead of CONFIRMED', async (t) => {
  const kernel = await boot(t);

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
});
