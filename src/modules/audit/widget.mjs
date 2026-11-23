import { validateWidgetOutput } from '../../types/contracts.mjs';
import { moduleDef } from './index.mjs';

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const EVENT_STYLE_BY_PREFIX = {
  'inventory.': 'background:rgba(52,211,153,0.14);border:1px solid rgba(52,211,153,0.35);color:#6ee7b7;',
  'order.': 'background:rgba(96,165,250,0.14);border:1px solid rgba(96,165,250,0.35);color:#93c5fd;',
  'invoice.': 'background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);color:#fde68a;',
};

const DEFAULT_EVENT_STYLE =
  'background:rgba(192,132,252,0.14);border:1px solid rgba(192,132,252,0.35);color:#d8b4fe;';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

function resolveEventBadgeStyle(eventName) {
  for (const [prefix, style] of Object.entries(EVENT_STYLE_BY_PREFIX)) {
    if (eventName.startsWith(prefix)) {
      return style;
    }
  }
  return DEFAULT_EVENT_STYLE;
}

function formatPayloadPreview(payload) {
  const raw = JSON.stringify(payload ?? {});
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

/**
 * Renders the Audit Event Ledger dashboard widget from persisted audit logs.
 * @param {object} ctx
 */
export function renderWidget(ctx) {
  const countRow = ctx.db.prepare('SELECT COUNT(*) AS total FROM audit_logs').get();
  const totalEvents = Number(countRow?.total ?? 0);
  const logs = moduleDef.services.listLogs(ctx, { limit: 8 });
  const latestEvent = logs[0] ?? null;

  const feedItemsHtml = logs
    .map((entry) => {
      const badgeStyle = resolveEventBadgeStyle(entry.eventName);
      const payloadPreview = formatPayloadPreview(entry.payload);
      return (
        `<li style="list-style:none;padding:8px 10px;border-radius:8px;background:#11182c;border:1px solid #253459;">` +
          `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">` +
            `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700;${badgeStyle}">${escapeHtml(entry.eventName)}</span>` +
            `<span style="font-size:0.72rem;color:#90a2c7;">#${escapeHtml(entry.id)} · ${escapeHtml(entry.createdAt)}</span>` +
          `</div>` +
          `<code style="display:block;font-size:0.76rem;color:#cbd5e1;word-break:break-all;">${escapeHtml(payloadPreview)}</code>` +
        `</li>`
      );
    })
    .join('');

  const bodyHtml =
    logs.length === 0
      ? `<div style="padding:10px;border-radius:8px;background:#11182c;border:1px solid #253459;color:#90a2c7;font-size:0.8rem;">No persisted audit events yet. Subscribed to <code>inventory.reserved</code>, <code>inventory.restocked</code>, <code>order.created</code>, and <code>invoice.created</code>.</div>`
      : `<ul style="margin:0;padding:0;display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">${feedItemsHtml}</ul>`;

  const html =
    `<div style="color:#e6eefc;">` +
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.75rem;color:#90a2c7;">` +
        `<span>Recent Event Feed (${escapeHtml(logs.length)} of ${escapeHtml(totalEvents)})</span>` +
        `<span style="color:#6ee7b7;font-weight:600;">Agent-Audit</span>` +
      `</div>` +
      bodyHtml +
    `</div>`;

  return validateWidgetOutput('audit', {
    slotId: 'audit',
    title: 'Audit Event Ledger',
    badge: totalEvents > 0 ? 'ACTIVE · LEDGER LIVE' : 'ACTIVE · LISTENING',
    summary:
      totalEvents > 0
        ? `Persisted ${totalEvents} event${totalEvents === 1 ? '' : 's'} from the microkernel Event Bus (latest: ${latestEvent.eventName}).`
        : 'Listening on Event Bus for inventory, order, and invoice events.',
    metrics: [
      { label: 'Total Events', value: String(totalEvents) },
      { label: 'Latest Event', value: latestEvent ? latestEvent.eventName : 'None' },
      { label: 'Agent Owner', value: 'Agent-Audit' },
    ],
    html,
  });
}
