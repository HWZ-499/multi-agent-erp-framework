import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from '../../core/kernel.mjs';
import { STUB_SERVICE_MOCKS, validateWidgetOutput } from '../../types/contracts.mjs';
import { renderWidget } from './widget.mjs';

async function boot(t) {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());
  return kernel;
}

function input(overrides = {}) {
  return { sku: 'SKU-DOCK', qty: 2, customer: 'Demo Customer', ...overrides };
}

test('orders boots ACTIVE with its own schema and unchanged slot identity', async (t) => {
  const kernel = await boot(t);
  const descriptor = kernel.modules.get('orders');
  assert.equal(descriptor.id, 'orders');
  assert.equal(descriptor.order, 20);
  assert.equal(descriptor.implemented, true);
  assert.equal(kernel.ctx.slotStatus.orders, 'ACTIVE');
  assert.deepEqual(await kernel.services.orders.listOrders(), []);
  const columns = kernel.db.prepare('PRAGMA table_info(orders_records)').all();
  assert.deepEqual(columns.map((col) => col.name), [
    'order_id', 'customer', 'sku', 'qty', 'unit_price', 'subtotal',
    'tax_amount', 'total_amount', 'invoice_id', 'status', 'created_at',
  ]);
});

test('real kernel orchestrates inventory and available billing, persists order and audit event', async (t) => {
  const kernel = await boot(t);
  const before = await kernel.services.inventory.getStock('SKU-DOCK');
  const request = Object.freeze(input({ orderId: 'ORD-E2E', customer: '  Demo Customer  ' }));
  let event;
  kernel.bus.on('order.created', (payload) => {
    event = payload;
    assert.ok(kernel.db.prepare('SELECT 1 FROM orders_records WHERE order_id = ?').get(payload.orderId));
  });
  const order = await kernel.services.orders.createOrder(request);
  assert.deepEqual(order, {
    orderId: 'ORD-E2E', customer: 'Demo Customer', sku: 'SKU-DOCK', qty: 2,
    unitPrice: 150, subtotal: 300, taxAmount: 24, totalAmount: 324,
    invoiceId: order.invoiceId, status: 'CONFIRMED',
    mockedInventory: kernel.ctx.slotStatus.inventory === 'STUB',
    mockedBilling: kernel.ctx.slotStatus.billing === 'STUB',
  });
  assert.equal(typeof order.invoiceId, 'string');
  assert.ok(order.invoiceId.length > 0);
  const row = kernel.db.prepare('SELECT * FROM orders_records WHERE order_id = ?').get(order.orderId);
  assert.deepEqual({ ...row }, {
    order_id: order.orderId, customer: order.customer, sku: order.sku, qty: 2,
    unit_price: 150, subtotal: 300, tax_amount: 24, total_amount: 324,
    invoice_id: order.invoiceId, status: 'CONFIRMED', created_at: row.created_at,
  });
  assert.equal(new Date(row.created_at).toISOString(), row.created_at);
  const stock = await kernel.services.inventory.getStock(order.sku);
  assert.equal(stock.availableQty, before.availableQty - 2);
  assert.equal(stock.reservedQty, before.reservedQty + 2);
  assert.deepEqual(event, {
    orderId: order.orderId, customer: order.customer, sku: order.sku, qty: 2,
    subtotal: 300, totalAmount: 324, invoiceId: order.invoiceId,
  });
  const logs = await kernel.services.audit.listLogs();
  assert.deepEqual(logs.find((log) => log.eventName === 'order.created').payload, event);
  assert.ok(logs.some((log) => log.eventName === 'inventory.reserved'));
  const calls = kernel.ctx.serviceCallLog.filter((call) =>
    call.method === 'reserveStock' || call.method === 'createInvoice');
  assert.deepEqual(calls.map(({ slotId, method, mode }) => ({ slotId, method, mode })), [
    { slotId: 'inventory', method: 'reserveStock', mode: 'ACTIVE' },
    { slotId: 'billing', method: 'createInvoice', mode: order.mockedBilling ? 'STUB_MOCK' : 'ACTIVE' },
  ]);
  if (!order.mockedBilling) {
    const invoices = await kernel.services.billing.listInvoices();
    assert.ok(invoices.some((invoice) => invoice.invoiceId === order.invoiceId));
    assert.ok(logs.some((log) => log.eventName === 'invoice.created'));
  }
});

for (const [field, value] of [
  ['sku', ''], ['sku', '  '], ['sku', null], ['sku', 123],
  ['customer', ''], ['customer', '  '], ['customer', null], ['customer', 123],
  ['qty', 0], ['qty', -1], ['qty', 1.5], ['qty', '2'], ['qty', NaN], ['qty', Infinity],
]) {
  test(`rejects invalid ${field} ${String(value)} before cross-module side effects`, async (t) => {
    const kernel = await boot(t);
    await assert.rejects(() => kernel.services.orders.createOrder(input({ [field]: value })),
      /non-empty string|positive integer/);
    assert.equal(kernel.ctx.serviceCallLog.some((call) => call.method === 'reserveStock' || call.method === 'createInvoice'), false);
    assert.deepEqual(await kernel.services.orders.listOrders(), []);
    assert.deepEqual(await kernel.services.audit.listLogs(), []);
  });
}

test('rejects missing input and invalid explicit order IDs before reservation', async (t) => {
  const kernel = await boot(t);
  await assert.rejects(() => kernel.services.orders.createOrder(), /sku/i);
  await assert.rejects(() => kernel.services.orders.createOrder(null), /sku/i);
  for (const orderId of ['', '  ', 123]) {
    await assert.rejects(() => kernel.services.orders.createOrder(input({ orderId })), /orderId/i);
  }
  assert.equal(kernel.ctx.serviceCallLog.some((call) => call.method === 'reserveStock'), false);
});

for (const taxRate of [undefined, null, -1, NaN, Infinity, '0.1', 0, 0.1]) {
  test(`uses the specified tax fallback for ${String(taxRate)}`, async (t) => {
    const kernel = await boot(t);
    const order = await kernel.services.orders.createOrder(input({ taxRate }));
    const expectedTax = taxRate === 0 ? 0 : taxRate === 0.1 ? 30 : 24;
    assert.equal(order.taxAmount, expectedTax);
    assert.equal(order.totalAmount, 300 + expectedTax);
  });
}

test('generates unique IDs and lists all DTOs newest first, including timestamp ties', async (t) => {
  const kernel = await boot(t);
  const first = await kernel.services.orders.createOrder(input());
  const second = await kernel.services.orders.createOrder(input());
  assert.notEqual(first.orderId, second.orderId);
  kernel.db.prepare('UPDATE orders_records SET created_at = ?').run('2026-01-01T00:00:00.000Z');
  let orders = await kernel.services.orders.listOrders();
  assert.deepEqual(orders.map((order) => order.orderId), [second.orderId, first.orderId]);
  assert.deepEqual(orders[0], {
    orderId: second.orderId, customer: second.customer, sku: second.sku, qty: second.qty,
    unitPrice: second.unitPrice, subtotal: second.subtotal, taxAmount: second.taxAmount,
    totalAmount: second.totalAmount, invoiceId: second.invoiceId, status: second.status,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  kernel.db.prepare('UPDATE orders_records SET created_at = ? WHERE order_id = ?')
    .run('2026-01-02T00:00:00.000Z', first.orderId);
  orders = await kernel.services.orders.listOrders();
  assert.deepEqual(orders.map((order) => order.orderId), [first.orderId, second.orderId]);
});

test('rejects an existing order ID before reserving stock again', async (t) => {
  const kernel = await boot(t);
  await kernel.services.orders.createOrder(input({ orderId: 'ORD-DUPLICATE' }));
  const before = await kernel.services.inventory.getStock('SKU-DOCK');
  await assert.rejects(() => kernel.services.orders.createOrder(input({ orderId: 'ORD-DUPLICATE' })), /already exists/i);
  assert.deepEqual(await kernel.services.inventory.getStock('SKU-DOCK'), before);
  assert.equal((await kernel.services.orders.listOrders()).length, 1);
});

test('reservation errors stop billing and do not persist or emit a confirmed order', async (t) => {
  const kernel = await boot(t);
  await assert.rejects(() => kernel.services.orders.createOrder(input({ qty: 999 })), /insufficient stock/i);
  assert.equal(kernel.ctx.serviceCallLog.some((call) => call.method === 'createInvoice'), false);
  assert.deepEqual(await kernel.services.orders.listOrders(), []);
  assert.deepEqual(await kernel.services.audit.listLogs(), []);
});

test('billing errors do not persist or emit a confirmed order', async (t) => {
  const kernel = await boot(t);
  t.mock.method(kernel.services.billing, 'createInvoice', async () => { throw new Error('Billing unavailable'); });
  await assert.rejects(() => kernel.services.orders.createOrder(input()), /Billing unavailable/);
  assert.deepEqual(await kernel.services.orders.listOrders(), []);
  assert.equal((await kernel.services.audit.listLogs()).some((log) => log.eventName === 'order.created'), false);
});

test('uses rounded reservation subtotal and authoritative non-mock billing response (service fixture)', async (t) => {
  const kernel = await boot(t);
  const inventory = t.mock.method(kernel.services.inventory, 'reserveStock', async () => ({ unitPrice: 10.125 }));
  const billing = t.mock.method(kernel.services.billing, 'createInvoice', async () => ({
    invoiceId: 'INV-FIXTURE', taxAmount: 1.11, totalAmount: 21.36,
  }));
  const order = await kernel.services.orders.createOrder(input({ orderId: 'ORD-FIXTURE', taxRate: 0.05 }));
  assert.deepEqual(inventory.mock.calls[0].arguments, [{ sku: 'SKU-DOCK', qty: 2, orderId: 'ORD-FIXTURE' }]);
  assert.deepEqual(billing.mock.calls[0].arguments, [{ orderId: 'ORD-FIXTURE', customer: 'Demo Customer', subtotal: 20.25, taxRate: 0.05 }]);
  assert.equal(order.unitPrice, 10.125);
  assert.equal(order.subtotal, 20.25);
  assert.equal(order.taxAmount, 1.11);
  assert.equal(order.totalAmount, 21.36);
  assert.equal(order.mockedInventory, false);
  assert.equal(order.mockedBilling, false);
  assert.equal((await kernel.services.orders.listOrders())[0].invoiceId, 'INV-FIXTURE');
});

test('supports frozen stub service responses independently of current module status (service fixture)', async (t) => {
  const kernel = await boot(t);
  t.mock.method(kernel.services.inventory, 'reserveStock', (request) => STUB_SERVICE_MOCKS.inventory.reserveStock(kernel.ctx, request));
  t.mock.method(kernel.services.billing, 'createInvoice', (request) => STUB_SERVICE_MOCKS.billing.createInvoice(kernel.ctx, request));
  const order = await kernel.services.orders.createOrder(input());
  assert.equal(order.mockedInventory, true);
  assert.equal(order.mockedBilling, true);
  assert.equal(order.status, 'PROVISIONAL_MOCK');
  assert.equal(order.totalAmount, 324);
  assert.equal((await kernel.services.orders.listOrders()).length, 1);
  assert.ok((await kernel.services.audit.listLogs()).some((log) => log.eventName === 'order.created'));
});

test('widget validates for empty/populated ledgers and integrates with dashboard and routes', async (t) => {
  const kernel = await boot(t);
  const empty = renderWidget(kernel.ctx);
  assert.equal(validateWidgetOutput('orders', empty), empty);
  assert.ok(empty.html.includes('No orders yet'));
  assert.ok(empty.html.includes('Built by Codex'));
  assert.ok(empty.metrics.some((item) => item.label === 'Total Orders' && item.value === '0'));
  assert.ok(empty.metrics.some((item) => item.label === 'Cumulative Revenue' && item.value === '$0.00'));
  await kernel.handleModuleRoute('orders', 'POST', 'createOrder', input({ customer: '<script>"x"</script> & \'Co\'' }));
  const orders = await kernel.handleModuleRoute('orders', 'GET', 'listOrders');
  assert.equal(orders.length, 1);
  const dashboard = await kernel.getDashboard();
  const widget = dashboard.slots.find((slot) => slot.slotId === 'orders');
  validateWidgetOutput('orders', widget);
  assert.equal(widget.status, 'ACTIVE');
  assert.equal(widget.title, 'Order Orchestration');
  assert.ok(widget.metrics.some((item) => item.label === 'Agent Vendor' && item.value === 'OpenAI Codex'));
  assert.ok(widget.metrics.some((item) => item.label === 'Total Orders' && item.value === '1'));
  assert.ok(widget.metrics.some((item) => item.label === 'Cumulative Revenue' && item.value === '$324.00'));
  assert.ok(widget.html.includes(orders[0].orderId));
  assert.ok(widget.html.includes('&lt;script&gt;&quot;x&quot;&lt;/script&gt; &amp; &#39;Co&#39;'));
  assert.doesNotMatch(widget.html, /<script>/);
});

test('widget limits recent rows while aggregating the entire orders ledger', async (t) => {
  const kernel = await boot(t);
  for (let n = 1; n <= 10; n++) {
    await kernel.services.orders.createOrder(input({ orderId: `ORD-${n}`, qty: 1 }));
  }
  const widget = renderWidget(kernel.ctx);
  assert.ok(widget.metrics.some((item) => item.label === 'Total Orders' && item.value === '10'));
  assert.ok(widget.metrics.some((item) => item.label === 'Cumulative Revenue' && item.value === '$1620.00'));
  assert.ok(widget.html.includes('ORD-10'));
  assert.doesNotMatch(widget.html, />ORD-1<|>ORD-2</);
  assert.equal((widget.html.match(/<tr>/g) || []).length, 9); // Header plus eight recent orders.
});
