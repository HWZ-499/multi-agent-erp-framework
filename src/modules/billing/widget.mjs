import { roundCurrency, validateWidgetOutput } from '../../types/contracts.mjs';

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const RECENT_LIMIT = 6;

/**
 * Escapes HTML special characters for safe template rendering.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * Formats a number as a USD amount.
 * @param {number} amount
 * @returns {string}
 */
function formatUsd(amount) {
  return `$${roundCurrency(amount).toFixed(2)}`;
}

/**
 * Renders the Billing & Invoice Ledger widget for the ERP dashboard.
 *
 * Reads only the local `billing_invoices` table; no cross-module imports.
 *
 * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
 */
export function renderWidget(ctx) {
  const totalsRow = ctx.db
    .prepare(
      'SELECT COUNT(*) AS total_invoices, COALESCE(SUM(total_amount), 0) AS total_billed, COALESCE(SUM(tax_amount), 0) AS tax_collected FROM billing_invoices'
    )
    .get();

  const totalInvoices = Number(totalsRow?.total_invoices ?? 0);
  const totalBilled = roundCurrency(Number(totalsRow?.total_billed ?? 0));
  const taxCollected = roundCurrency(Number(totalsRow?.tax_collected ?? 0));
  const averageInvoice = totalInvoices > 0 ? roundCurrency(totalBilled / totalInvoices) : 0;

  const rows = ctx.db
    .prepare(
      'SELECT invoice_id, order_id, customer, subtotal, tax_rate, tax_amount, total_amount, status, created_at FROM billing_invoices ORDER BY created_at DESC, rowid DESC LIMIT ?'
    )
    .all(RECENT_LIMIT);

  const tableRows = rows
    .map((row) => {
      const status = String(row.status);
      const statusStyle =
        status === 'PAID'
          ? 'background:rgba(52,211,153,0.14);border:1px solid rgba(52,211,153,0.35);color:#6ee7b7;'
          : 'background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);color:#fde68a;';

      return (
        '<tr style="border-bottom:1px solid #1e2b4d;">' +
        `<td style="padding:7px 8px;font-family:monospace;color:#bfdbfe;font-weight:600;">${escapeHtml(row.invoice_id)}</td>` +
        `<td style="padding:7px 8px;font-family:monospace;color:#90a2c7;">${escapeHtml(row.order_id)}</td>` +
        `<td style="padding:7px 8px;color:#e6eefc;">${escapeHtml(row.customer)}</td>` +
        `<td style="padding:7px 8px;text-align:right;color:#e6eefc;">${formatUsd(row.subtotal)}</td>` +
        `<td style="padding:7px 8px;text-align:right;color:#90a2c7;">${formatUsd(row.tax_amount)}</td>` +
        `<td style="padding:7px 8px;text-align:right;color:#e6eefc;font-weight:700;">${formatUsd(row.total_amount)}</td>` +
        `<td style="padding:7px 8px;text-align:center;"><span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:0.68rem;font-weight:700;${statusStyle}">${escapeHtml(status)}</span></td>` +
        '</tr>'
      );
    })
    .join('');

  const bodyHtml =
    rows.length > 0
      ? tableRows
      : '<tr><td colspan="7" style="padding:12px;text-align:center;color:#90a2c7;">No invoices yet. Create one via <code>billing.createInvoice</code>.</td></tr>';

  const html =
    '<div style="color:#e6eefc;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:0.75rem;color:#90a2c7;">' +
    `<span>Invoice Ledger (${escapeHtml(Math.min(rows.length, totalInvoices))} of ${escapeHtml(totalInvoices)} recent)</span>` +
    '<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.72rem;color:#818cf8;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:999px;padding:2px 8px;font-weight:600;">Built by OpenCode</span>' +
    '</div>' +
    '<div style="overflow-x:auto;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;background:#0d1426;border:1px solid #253459;border-radius:8px;">' +
    '<thead>' +
    '<tr style="background:#17213b;color:#90a2c7;text-transform:uppercase;font-size:0.7rem;letter-spacing:0.04em;border-bottom:1px solid #253459;">' +
    '<th style="padding:7px 8px;text-align:left;">Invoice</th>' +
    '<th style="padding:7px 8px;text-align:left;">Order</th>' +
    '<th style="padding:7px 8px;text-align:left;">Customer</th>' +
    '<th style="padding:7px 8px;text-align:right;">Subtotal</th>' +
    '<th style="padding:7px 8px;text-align:right;">Tax</th>' +
    '<th style="padding:7px 8px;text-align:right;">Total</th>' +
    '<th style="padding:7px 8px;text-align:center;">Status</th>' +
    '</tr>' +
    '</thead>' +
    `<tbody>${bodyHtml}</tbody>` +
    '</table>' +
    '</div>' +
    '</div>';

  return validateWidgetOutput('billing', {
    slotId: 'billing',
    title: 'Billing & Invoice Ledger',
    badge: totalInvoices > 0 ? 'ACTIVE · PAID LEDGER' : 'ACTIVE · NO INVOICES',
    summary:
      totalInvoices > 0
        ? `Ledger holds ${totalInvoices} PAID invoice${totalInvoices === 1 ? '' : 's'} totalling ${formatUsd(totalBilled)} with ${formatUsd(taxCollected)} tax collected.`
        : 'Invoice ledger is live; no invoices have been issued yet.',
    metrics: [
      { label: 'Total Invoices', value: String(totalInvoices) },
      { label: 'Total Billed', value: formatUsd(totalBilled) },
      { label: 'Tax Collected', value: formatUsd(taxCollected) },
      { label: 'Avg Invoice', value: formatUsd(averageInvoice) },
      { label: 'Agent Vendor', value: 'OpenCode' },
    ],
    html,
  });
}
