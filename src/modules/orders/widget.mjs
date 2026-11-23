import { roundCurrency, validateWidgetOutput } from '../../types/contracts.mjs';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUsd(amount) {
  return `$${roundCurrency(amount).toFixed(2)}`;
}

/** Renders only this module's persisted ledger; totals include all orders. */
export function renderWidget(ctx) {
  const totals = ctx.db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS revenue
    FROM orders_records WHERE status != 'PENDING'
  `).get();
  const recent = ctx.db.prepare(`
    SELECT order_id, customer, sku, qty, total_amount, status, created_at
    FROM orders_records WHERE status != 'PENDING' ORDER BY created_at DESC, rowid DESC LIMIT 8
  `).all();
  const cellStyle = 'padding:8px;text-align:left;border-bottom:1px solid #263459;overflow-wrap:anywhere;';
  const rows = recent.map((order) => `<tr>${[
    order.order_id, order.customer, `${order.sku} × ${order.qty}`,
    formatUsd(order.total_amount), order.status, order.created_at,
  ].map((value) => `<td style="${cellStyle}">${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  const body = recent.length === 0
    ? '<p style="margin:0;color:#94a3b8;">No orders yet. Confirmed orders will appear here.</p>'
    : `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
        <caption style="text-align:left;color:#94a3b8;padding-bottom:8px;">Recent orders (${recent.length} of ${totals.count})</caption>
        <thead><tr>${['Order', 'Customer', 'Items', 'Total', 'Status', 'Created at (UTC)']
          .map((label) => `<th scope="col" style="${cellStyle}color:#93c5fd;">${label}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return validateWidgetOutput('orders', {
    slotId: 'orders',
    title: 'Order Orchestration',
    badge: totals.count > 0 ? 'ACTIVE · ORDERS CONFIRMED' : 'ACTIVE · READY',
    summary: `${totals.count} confirmed orders with ${formatUsd(totals.revenue)} cumulative revenue (including tax).`,
    metrics: [
      { label: 'Total Orders', value: String(totals.count) },
      { label: 'Cumulative Revenue', value: formatUsd(totals.revenue) },
      { label: 'Agent Vendor', value: 'OpenAI Codex' },
    ],
    html: `<div style="display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid #263459;border-radius:10px;background:#11182c;color:#e7eefc;">
      <span style="align-self:flex-start;padding:4px 10px;border:1px solid #34d399;border-radius:999px;background:#12352f;color:#6ee7b7;font-size:0.74rem;font-weight:700;">Built by Codex</span>
      ${body}
    </div>`,
  });
}
