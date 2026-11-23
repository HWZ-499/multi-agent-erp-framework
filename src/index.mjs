import { createKernel } from './core/kernel.mjs';

const kernel = await createKernel({ dbPath: ':memory:' });

try {
  console.log('=== Multi-Agent Microkernel ERP Smoke Run ===');
  for (const [slotId, status] of Object.entries(kernel.ctx.slotStatus)) {
    console.log(`Module [${slotId.padEnd(9)}] -> ${status}`);
  }

  console.log('\nExecuting cross-module order workflow (SKU-LAPTOP x 2)...');
  const order = await kernel.services.orders.createOrder({
    sku: 'SKU-LAPTOP',
    qty: 2,
    customer: 'Acme Robotics',
    taxRate: 0.08,
  });

  console.log('Order Result:', JSON.stringify(order));

  const dash = await kernel.getDashboard();
  console.log('\nService Bus Call Trace:');
  for (const call of dash.serviceCallLog) {
    console.log(` - ${call.slotId}.${call.method}() [${call.mode}]`);
  }

  console.log('\nDashboard Widgets:');
  for (const slot of dash.slots) {
    console.log(` - ${slot.slotId}: [${slot.status}] ${slot.title} (${slot.badge})`);
  }
} finally {
  kernel.close();
}
