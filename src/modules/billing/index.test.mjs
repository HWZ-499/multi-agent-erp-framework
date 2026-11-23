import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from '../../core/kernel.mjs';
import { validateWidgetOutput } from '../../types/contracts.mjs';
import { renderWidget } from './widget.mjs';

async function bootKernel(t) {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());
  return kernel;
}

test('billing module boots ACTIVE with frozen metadata and its own schema table', async (t) => {
  const kernel = await bootKernel(t);

  assert.equal(kernel.ctx.slotStatus.billing, 'ACTIVE');
  const mod = kernel.modules.get('billing');
  assert.equal(mod.id, 'billing');
  assert.equal(mod.order, 30);
  assert.equal(mod.implemented, true);
  assert.equal(typeof mod.services.createInvoice, 'function');
  assert.equal(typeof mod.services.listInvoices, 'function');

  const table = kernel.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'billing_invoices'")
    .get();
  assert.ok(table, 'billing_invoices table should exist');
});

test('createInvoice applies the default 8% tax, persists a PAID row, and emits invoice.created', async (t) => {
  const kernel = await bootKernel(t);

  const emitted = [];
  kernel.bus.on('invoice.created', (payload) => emitted.push(payload));

  const invoice = await kernel.services.billing.createInvoice({
    orderId: 'ORD-1001',
    customer: 'Acme Corp',
    subtotal: 100,
  });

  assert.match(invoice.invoiceId, /^INV-\d+-\d+-\d+$/);
  assert.equal(invoice.orderId, 'ORD-1001');
  assert.equal(invoice.customer, 'Acme Corp');
  assert.equal(invoice.subtotal, 100);
  assert.equal(invoice.taxRate, 0.08);
  assert.equal(invoice.taxAmount, 8);
  assert.equal(invoice.totalAmount, 108);
  assert.equal(invoice.status, 'PAID');

  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], {
    invoiceId: invoice.invoiceId,
    orderId: 'ORD-1001',
    customer: 'Acme Corp',
    subtotal: 100,
    taxRate: 0.08,
    taxAmount: 8,
    totalAmount: 108,
    status: 'PAID',
  });

  const row = kernel.db
    .prepare('SELECT * FROM billing_invoices WHERE invoice_id = ?')
    .get(invoice.invoiceId);
  assert.ok(row);
  assert.equal(row.order_id, 'ORD-1001');
  assert.equal(row.customer, 'Acme Corp');
  assert.equal(row.subtotal, 100);
  assert.equal(row.tax_rate, 0.08);
  assert.equal(row.tax_amount, 8);
  assert.equal(row.total_amount, 108);
  assert.equal(row.status, 'PAID');
  assert.ok(!Number.isNaN(Date.parse(row.created_at)));

  const [listed] = await kernel.services.billing.listInvoices();
  assert.deepEqual(listed, { ...invoice, createdAt: row.created_at });
});

test('createInvoice rounds subtotal, tax, and total to two decimals', async (t) => {
  const kernel = await bootKernel(t);

  const nearHundred = await kernel.services.billing.createInvoice({
    orderId: 'ORD-ROUND-1',
    customer: 'Rounding Co',
    subtotal: 99.99,
    taxRate: 0.08,
  });
  assert.equal(nearHundred.subtotal, 99.99);
  assert.equal(nearHundred.taxAmount, 8);
  assert.equal(nearHundred.totalAmount, 107.99);

  const fractionalRate = await kernel.services.billing.createInvoice({
    orderId: 'ORD-ROUND-2',
    customer: 'Fractional Co',
    subtotal: 19.99,
    taxRate: 0.0825,
  });
  assert.equal(fractionalRate.subtotal, 19.99);
  assert.equal(fractionalRate.taxAmount, 1.65);
  assert.equal(fractionalRate.totalAmount, 21.64);

  const zeroSubtotal = await kernel.services.billing.createInvoice({
    orderId: 'ORD-ROUND-3',
    customer: 'Zero Co',
    subtotal: 0,
    taxRate: 0.08,
  });
  assert.equal(zeroSubtotal.taxAmount, 0);
  assert.equal(zeroSubtotal.totalAmount, 0);
});

test('createInvoice rejects invalid orderId, customer, subtotal, and taxRate', async (t) => {
  const kernel = await bootKernel(t);
  const valid = { orderId: 'ORD-2000', customer: 'Valid Co', subtotal: 10, taxRate: 0.08 };

  await assert.rejects(() => kernel.services.billing.createInvoice(), /orderId/i);
  await assert.rejects(() => kernel.services.billing.createInvoice('nope'), /orderId/i);
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, orderId: '' }),
    /orderId/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, orderId: '   ' }),
    /orderId/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, orderId: 42 }),
    /orderId/i
  );

  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, customer: undefined }),
    /customer/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, customer: '' }),
    /customer/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, customer: 123 }),
    /customer/i
  );

  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, subtotal: -0.01 }),
    /subtotal/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, subtotal: Number.NaN }),
    /subtotal/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, subtotal: Number.POSITIVE_INFINITY }),
    /subtotal/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, subtotal: '10' }),
    /subtotal/i
  );

  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, taxRate: -0.01 }),
    /taxRate/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, taxRate: Number.NaN }),
    /taxRate/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, taxRate: Number.POSITIVE_INFINITY }),
    /taxRate/i
  );
  await assert.rejects(
    () => kernel.services.billing.createInvoice({ ...valid, taxRate: '0.08' }),
    /taxRate/i
  );

  const invoices = await kernel.services.billing.listInvoices();
  assert.equal(invoices.length, 0);
});

test('listInvoices returns all invoices newest first with generated ids unique', async (t) => {
  const kernel = await bootKernel(t);

  const first = await kernel.services.billing.createInvoice({
    orderId: 'ORD-3001',
    customer: 'First Co',
    subtotal: 10,
  });
  const second = await kernel.services.billing.createInvoice({
    orderId: 'ORD-3002',
    customer: 'Second Co',
    subtotal: 20,
  });
  const third = await kernel.services.billing.createInvoice({
    orderId: 'ORD-3003',
    customer: 'Third Co',
    subtotal: 30,
  });

  assert.notEqual(first.invoiceId, second.invoiceId);
  assert.notEqual(second.invoiceId, third.invoiceId);
  assert.notEqual(first.invoiceId, third.invoiceId);

  const invoices = await kernel.services.billing.listInvoices();
  assert.deepEqual(
    invoices.map((invoice) => invoice.orderId),
    ['ORD-3003', 'ORD-3002', 'ORD-3001']
  );
  for (const invoice of invoices) {
    assert.ok(!Number.isNaN(Date.parse(invoice.createdAt)));
    assert.equal(invoice.status, 'PAID');
  }
});

test('invoice.created is published on the Event Bus and persisted by the audit module', async (t) => {
  const kernel = await bootKernel(t);

  const invoice = await kernel.services.billing.createInvoice({
    orderId: 'ORD-4001',
    customer: 'Audit Co',
    subtotal: 42.5,
    taxRate: 0.08,
  });

  const logs = await kernel.services.audit.listLogs();
  const invoiceLog = logs.find((entry) => entry.eventName === 'invoice.created');
  assert.ok(invoiceLog, 'audit should persist invoice.created');
  assert.deepEqual(invoiceLog.payload, {
    invoiceId: invoice.invoiceId,
    orderId: 'ORD-4001',
    customer: 'Audit Co',
    subtotal: 42.5,
    taxRate: 0.08,
    taxAmount: 3.4,
    totalAmount: 45.9,
    status: 'PAID',
  });
});

test('billing is consumed through the Service Bus by the orchestration stub without imports', async (t) => {
  const kernel = await bootKernel(t);

  const order = await kernel.services.orders.createOrder({
    sku: 'SKU-MONITOR',
    qty: 2,
    customer: 'Bus Customer',
    taxRate: 0.05,
  });

  assert.equal(order.subtotal, 700);
  assert.equal(order.taxAmount, 35);
  assert.equal(order.totalAmount, 735);

  const invoices = await kernel.services.billing.listInvoices();
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].orderId, order.orderId);
  assert.equal(invoices[0].invoiceId, order.invoiceId);
  assert.equal(invoices[0].subtotal, 700);
  assert.equal(invoices[0].taxAmount, 35);
  assert.equal(invoices[0].totalAmount, 735);

  const billingCall = kernel.ctx.serviceCallLog.find(
    (entry) => entry.slotId === 'billing' && entry.method === 'createInvoice'
  );
  assert.ok(billingCall);
  assert.equal(billingCall.mode, 'ACTIVE');
});

test('renderWidget renders an empty ledger that satisfies the widget contract', async (t) => {
  const kernel = await bootKernel(t);
  const widget = validateWidgetOutput('billing', renderWidget(kernel.ctx));

  assert.equal(widget.slotId, 'billing');
  assert.equal(widget.title, 'Billing & Invoice Ledger');
  assert.equal(widget.badge, 'ACTIVE · NO INVOICES');
  assert.match(widget.summary, /no invoices/i);
  assert.deepEqual(widget.metrics, [
    { label: 'Total Invoices', value: '0' },
    { label: 'Total Billed', value: '$0.00' },
    { label: 'Tax Collected', value: '$0.00' },
    { label: 'Avg Invoice', value: '$0.00' },
    { label: 'Agent Vendor', value: 'OpenCode' },
  ]);
  assert.match(widget.html, /No invoices yet/);
  assert.match(widget.html, /Built by OpenCode/);
});

test('renderWidget aggregates invoices, lists recent rows, and escapes HTML', async (t) => {
  const kernel = await bootKernel(t);

  const first = await kernel.services.billing.createInvoice({
    orderId: 'ORD-5001',
    customer: 'Ledger Co',
    subtotal: 100,
    taxRate: 0.08,
  });
  const second = await kernel.services.billing.createInvoice({
    orderId: 'ORD-5002',
    customer: '<script>alert("xss")</script> & "Co"',
    subtotal: 250.5,
    taxRate: 0.1,
  });

  const widget = validateWidgetOutput('billing', renderWidget(kernel.ctx));

  assert.equal(widget.slotId, 'billing');
  assert.equal(widget.title, 'Billing & Invoice Ledger');
  assert.equal(widget.badge, 'ACTIVE · PAID LEDGER');
  assert.match(widget.summary, /\$383\.55/);
  assert.match(widget.summary, /\$33\.05/);
  assert.deepEqual(widget.metrics, [
    { label: 'Total Invoices', value: '2' },
    { label: 'Total Billed', value: '$383.55' },
    { label: 'Tax Collected', value: '$33.05' },
    { label: 'Avg Invoice', value: '$191.78' },
    { label: 'Agent Vendor', value: 'OpenCode' },
  ]);

  assert.match(widget.html, /Built by OpenCode/);
  assert.match(widget.html, new RegExp(first.invoiceId));
  assert.match(widget.html, new RegExp(second.invoiceId));
  assert.match(widget.html, /PAID/);
  assert.match(widget.html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt; &amp; &quot;Co&quot;/);
  assert.ok(!widget.html.includes('<script>alert'));

  const dashboard = await kernel.getDashboard();
  const billingSlot = dashboard.slots.find((slot) => slot.slotId === 'billing');
  assert.ok(billingSlot);
  assert.equal(billingSlot.status, 'ACTIVE');
  assert.deepEqual(billingSlot.metrics, widget.metrics);
  assert.match(billingSlot.html, /Built by OpenCode/);
});

test('voidInvoice deletes persisted invoice idempotently and emits invoice.voided', async (t) => {
  const kernel = await bootKernel(t);

  const invoice = await kernel.services.billing.createInvoice({
    orderId: 'ORD-VOID-1',
    customer: 'Void Co',
    subtotal: 100,
    taxRate: 0.08,
  });
  assert.equal((await kernel.services.billing.listInvoices()).length, 1);

  const voided = await kernel.services.billing.voidInvoice({
    invoiceId: invoice.invoiceId,
    orderId: 'ORD-VOID-1',
  });
  assert.deepEqual(voided, {
    voided: true,
    invoiceId: invoice.invoiceId,
    orderId: 'ORD-VOID-1',
    status: 'VOIDED',
  });
  assert.equal((await kernel.services.billing.listInvoices()).length, 0);

  const repeat = await kernel.services.billing.voidInvoice({
    invoiceId: invoice.invoiceId,
    orderId: 'ORD-VOID-1',
  });
  assert.equal(repeat.voided, false);
  assert.equal(repeat.alreadyVoided, true);

  const logs = await kernel.services.audit.listLogs();
  assert.ok(logs.some((entry) => entry.eventName === 'invoice.voided'));
});
