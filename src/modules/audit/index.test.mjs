import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from '../../core/kernel.mjs';
import { validateWidgetOutput } from '../../types/contracts.mjs';
import { renderWidget } from './widget.mjs';

test('audit module boots active with expected descriptor', async (t) => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());

  assert.equal(kernel.ctx.slotStatus.audit, 'ACTIVE');
  const mod = kernel.modules.get('audit');
  assert.equal(mod.id, 'audit');
  assert.equal(mod.order, 40);
  assert.equal(mod.implemented, true);
});

test('record and listLogs validate inputs, persist rows, and return newest first', async (t) => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());

  await assert.rejects(
    () => kernel.services.audit.record({ eventName: '' }),
    /non-empty string/i
  );
  await assert.rejects(
    () => kernel.services.audit.record({ eventName: '   ', payload: { x: 1 } }),
    /non-empty string/i
  );
  await assert.rejects(
    () => kernel.services.audit.record({ payload: { x: 1 } }),
    /non-empty string/i
  );

  const first = await kernel.services.audit.record({
    eventName: 'audit.first',
    payload: { step: 1, ok: true },
  });
  assert.equal(typeof first.id, 'number');
  assert.equal(first.id, 1);
  assert.equal(first.eventName, 'audit.first');
  assert.deepEqual(first.payload, { step: 1, ok: true });
  assert.ok(!Number.isNaN(Date.parse(first.createdAt)));

  const second = await kernel.services.audit.record({
    eventName: 'audit.second',
  });
  assert.equal(second.id, 2);
  assert.equal(second.eventName, 'audit.second');
  assert.deepEqual(second.payload, {});

  const third = await kernel.services.audit.record({
    eventName: 'audit.third',
    payload: { step: 3 },
  });
  assert.equal(third.id, 3);

  const allLogs = await kernel.services.audit.listLogs();
  assert.equal(allLogs.length, 3);
  assert.deepEqual(
    allLogs.map((row) => row.id),
    [3, 2, 1]
  );
  assert.deepEqual(allLogs[0].payload, { step: 3 });
  assert.deepEqual(allLogs[1].payload, {});
  assert.deepEqual(allLogs[2].payload, { step: 1, ok: true });

  const limited = await kernel.services.audit.listLogs({ limit: 2 });
  assert.equal(limited.length, 2);
  assert.deepEqual(
    limited.map((row) => row.eventName),
    ['audit.third', 'audit.second']
  );

  await assert.rejects(
    () => kernel.services.audit.listLogs({ limit: 0 }),
    /positive integer/i
  );
  await assert.rejects(
    () => kernel.services.audit.listLogs({ limit: -1 }),
    /positive integer/i
  );
});

test('init subscribes to inventory, order, and invoice bus events and persists them', async (t) => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());

  const expectedEvents = [
    { name: 'inventory.reserved', payload: { sku: 'SKU-LAPTOP', qty: 2, orderId: 'ORD-100' } },
    { name: 'inventory.restocked', payload: { sku: 'SKU-LAPTOP', qty: 5, availableQty: 30 } },
    { name: 'order.created', payload: { orderId: 'ORD-100', totalAmount: 2592 } },
    { name: 'invoice.created', payload: { invoiceId: 'INV-100', orderId: 'ORD-100', status: 'PAID' } },
  ];

  for (const evt of expectedEvents) {
    kernel.bus.emit(evt.name, evt.payload);
  }
  kernel.bus.emit('unsubscribed.event', { ignore: true });

  const logs = await kernel.services.audit.listLogs();
  assert.equal(logs.length, 4);

  const reversed = [...expectedEvents].reverse();
  for (const [idx, evt] of reversed.entries()) {
    assert.equal(logs[idx].eventName, evt.name);
    assert.deepEqual(logs[idx].payload, evt.payload);
    assert.ok(!Number.isNaN(Date.parse(logs[idx].createdAt)));
  }
});

test('renderWidget produces valid contract output and escapes HTML in dark-theme feed', async (t) => {
  const kernel = await createKernel({ dbPath: ':memory:' });
  t.after(() => kernel.close());

  const emptyWidget = validateWidgetOutput('audit', renderWidget(kernel.ctx));
  assert.equal(emptyWidget.slotId, 'audit');
  assert.equal(emptyWidget.title, 'Audit Event Ledger');
  assert.deepEqual(emptyWidget.metrics, [
    { label: 'Total Events', value: '0' },
    { label: 'Latest Event', value: 'None' },
    { label: 'Agent Owner', value: 'Agent-Audit' },
  ]);

  await kernel.services.audit.record({
    eventName: 'order.created',
    payload: {
      orderId: 'ORD-XSS',
      customer: '<script>alert("xss")</script> & "Co"',
    },
  });

  const populatedWidget = validateWidgetOutput('audit', renderWidget(kernel.ctx));
  assert.equal(populatedWidget.slotId, 'audit');
  assert.equal(populatedWidget.title, 'Audit Event Ledger');
  assert.deepEqual(populatedWidget.metrics, [
    { label: 'Total Events', value: '1' },
    { label: 'Latest Event', value: 'order.created' },
    { label: 'Agent Owner', value: 'Agent-Audit' },
  ]);

  assert.ok(populatedWidget.html.includes('#11182c'));
  assert.ok(populatedWidget.html.includes('order.created'));
  assert.ok(!populatedWidget.html.includes('<script>'));
  assert.ok(populatedWidget.html.includes('&lt;script&gt;alert(\\&quot;xss\\&quot;)&lt;/script&gt; &amp; \\&quot;Co\\&quot;'));

  const dashboard = await kernel.getDashboard();
  const auditSlot = dashboard.slots.find((slot) => slot.slotId === 'audit');
  assert.ok(auditSlot);
  assert.equal(auditSlot.status, 'ACTIVE');
  validateWidgetOutput('audit', {
    slotId: auditSlot.slotId,
    title: auditSlot.title,
    badge: auditSlot.badge,
    summary: auditSlot.summary,
    metrics: auditSlot.metrics,
    html: auditSlot.html,
  });
});
