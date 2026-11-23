import { roundCurrency, validateWidgetOutput } from '../../types/contracts.mjs';

/**
 * Escapes HTML special characters for safe template rendering.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the Inventory & Stock Ledger widget for the ERP dashboard.
 * @param {{ db: import('node:sqlite').DatabaseSync }} ctx
 */
export function renderWidget(ctx) {
  const rows = ctx.db
    .prepare(
      'SELECT sku, name, available_qty, reserved_qty, unit_price FROM inventory_items ORDER BY sku ASC'
    )
    .all();

  let availableUnits = 0;
  let reservedUnits = 0;

  const tableRows = rows
    .map((row) => {
      const availableQty = Number(row.available_qty) || 0;
      const reservedQty = Number(row.reserved_qty) || 0;
      const unitPrice = roundCurrency(row.unit_price);

      availableUnits += availableQty;
      reservedUnits += reservedQty;

      const qtyColor =
        availableQty === 0 ? '#f87171' : availableQty <= 5 ? '#fbbf24' : '#34d399';
      const reservedColor = reservedQty > 0 ? '#60a5fa' : '#90a2c7';

      return (
        '<tr style="border-bottom:1px solid #1e2b4d;">' +
        `<td style="padding:7px 8px;font-family:monospace;color:#bfdbfe;font-weight:600;">${escapeHtml(row.sku)}</td>` +
        `<td style="padding:7px 8px;color:#e6eefc;">${escapeHtml(row.name)}</td>` +
        `<td style="padding:7px 8px;text-align:right;font-weight:700;color:${qtyColor};">${availableQty}</td>` +
        `<td style="padding:7px 8px;text-align:right;font-weight:600;color:${reservedColor};">${reservedQty}</td>` +
        `<td style="padding:7px 8px;text-align:right;color:#e6eefc;">$${unitPrice.toFixed(2)}</td>` +
        '</tr>'
      );
    })
    .join('');

  const bodyHtml =
    tableRows.length > 0
      ? tableRows
      : '<tr><td colspan="5" style="padding:10px;text-align:center;color:#90a2c7;">No SKUs in inventory ledger.</td></tr>';

  const html =
    '<div style="overflow-x:auto;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;background:#0d1426;border:1px solid #253459;border-radius:8px;">' +
    '<thead>' +
    '<tr style="background:#17213b;color:#90a2c7;text-transform:uppercase;font-size:0.7rem;letter-spacing:0.04em;border-bottom:1px solid #253459;">' +
    '<th style="padding:7px 8px;text-align:left;">SKU</th>' +
    '<th style="padding:7px 8px;text-align:left;">Name</th>' +
    '<th style="padding:7px 8px;text-align:right;">Available</th>' +
    '<th style="padding:7px 8px;text-align:right;">Reserved</th>' +
    '<th style="padding:7px 8px;text-align:right;">Unit Price</th>' +
    '</tr>' +
    '</thead>' +
    `<tbody>${bodyHtml}</tbody>` +
    '</table>' +
    '</div>';

  const totalSkus = rows.length;

  return validateWidgetOutput('inventory', {
    slotId: 'inventory',
    title: 'Inventory & Stock Ledger',
    badge: 'ACTIVE · SQLITE',
    summary: `Tracking ${totalSkus} SKUs with ${availableUnits} available and ${reservedUnits} reserved units in SQLite.`,
    metrics: [
      { label: 'Total SKUs', value: String(totalSkus) },
      { label: 'Available Units', value: String(availableUnits) },
      { label: 'Reserved Units', value: String(reservedUnits) },
      { label: 'Agent Owner', value: 'Agent-Inventory' },
    ],
    html,
  });
}
