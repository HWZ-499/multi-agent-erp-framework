import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createKernel } from './core/kernel.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'erp.sqlite');

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 64) {
        rejectBody(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', rejectBody);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const WORKBENCH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Multi-Agent Microkernel ERP Workbench</title>
  <style>
    :root {
      --bg: #080d1a;
      --panel: #11182c;
      --panel-alt: #17213b;
      --border: #253459;
      --text: #e6eefc;
      --muted: #90a2c7;
      --accent: #60a5fa;
      --green: #34d399;
      --amber: #fbbf24;
      --red: #f87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top left, #162244 0%, var(--bg) 55%);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      padding: 18px 28px;
      border-bottom: 1px solid var(--border);
      background: rgba(8, 13, 26, 0.85);
      backdrop-filter: blur(10px);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    header h1 { margin: 0; font-size: 1.2rem; }
    header p { margin: 4px 0 0; font-size: 0.84rem; color: var(--muted); }
    .pill {
      font-size: 0.78rem;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(96, 165, 250, 0.14);
      border: 1px solid rgba(96, 165, 250, 0.35);
      color: #bfdbfe;
      font-weight: 600;
    }
    main {
      max-width: 1460px;
      margin: 0 auto;
      padding: 22px;
      display: grid;
      grid-template-columns: 330px minmax(0, 1fr) 340px;
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 1200px) {
      main { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
    }
    .panel h2.sec-title {
      margin: 0 0 14px;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    .field { margin-bottom: 12px; }
    .field label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .field input, .field select {
      width: 100%;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      color: var(--text);
      font-size: 0.9rem;
    }
    .btn {
      width: 100%;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(96, 165, 250, 0.5);
      background: rgba(59, 130, 246, 0.25);
      color: #eff6ff;
      font-weight: 700;
      cursor: pointer;
      font-size: 0.9rem;
      margin-top: 6px;
    }
    .btn:hover { background: rgba(59, 130, 246, 0.38); }
    .btn.secondary {
      background: var(--panel-alt);
      border-color: var(--border);
      margin-top: 10px;
    }
    .grid-2x2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    @media (max-width: 900px) {
      .grid-2x2 { grid-template-columns: 1fr; }
    }
    .slot-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
    }
    .slot-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
    }
    .slot-head h3 { margin: 0; font-size: 1rem; }
    .slot-owner { font-size: 0.74rem; color: var(--muted); margin-top: 3px; }
    .badge {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 4px 9px;
      border-radius: 999px;
      background: rgba(52, 211, 153, 0.14);
      border: 1px solid rgba(52, 211, 153, 0.35);
      color: #6ee7b7;
      white-space: nowrap;
    }
    .badge.stub {
      background: rgba(251, 191, 36, 0.14);
      border-color: rgba(251, 191, 36, 0.35);
      color: #fde68a;
    }
    .summary { margin: 0 0 10px; font-size: 0.84rem; color: var(--muted); }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .metric {
      background: var(--panel-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
    }
    .metric .k { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; }
    .metric .v { font-size: 0.9rem; font-weight: 700; margin-top: 2px; }
    .widget-box {
      background: rgba(8, 13, 26, 0.65);
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 12px;
      font-size: 0.84rem;
    }
    .trace-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      border-bottom: 1px solid rgba(37, 52, 89, 0.65);
      font-size: 0.82rem;
    }
    .mode-active { color: var(--green); font-weight: 700; }
    .mode-mock { color: var(--amber); font-weight: 700; }
    .status-msg {
      margin-top: 10px;
      font-size: 0.82rem;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--panel-alt);
      border: 1px solid var(--border);
      min-height: 36px;
    }
    .status-msg.err { border-color: var(--red); color: #fca5a5; }
    .status-msg.ok { border-color: var(--green); color: #6ee7b7; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Multi-Agent Microkernel ERP Workbench</h1>
      <p>SQLite Per-Slot Schemas · Cross-Module Service Bus with Auto-Mocks · Event Bus · CI Boundary Guard</p>
    </div>
    <span class="pill" id="kernel-health">Connecting to Microkernel...</span>
  </header>

  <main>
    <section class="panel">
      <h2 class="sec-title">Cross-Module Order Workflow</h2>
      <div class="field">
        <label for="customer-input">Customer</label>
        <input id="customer-input" type="text" value="Acme Robotics" />
      </div>
      <div class="field">
        <label for="sku-select">SKU Item</label>
        <select id="sku-select">
          <option value="SKU-LAPTOP">SKU-LAPTOP ($1,200)</option>
          <option value="SKU-MONITOR">SKU-MONITOR ($350)</option>
          <option value="SKU-DOCK">SKU-DOCK ($150)</option>
        </select>
      </div>
      <div class="field">
        <label for="qty-input">Quantity</label>
        <input id="qty-input" type="number" min="1" max="50" value="2" />
      </div>
      <div class="field">
        <label for="tax-input">Tax Rate (e.g. 0.08)</label>
        <input id="tax-input" type="number" step="0.01" min="0" max="0.5" value="0.08" />
      </div>
      <button class="btn" id="place-order-btn">Execute Order Workflow</button>
      <button class="btn secondary" id="restock-btn">Restock +5 Selected SKU</button>
      <div class="status-msg" id="action-status">Ready.</div>
    </section>

    <section class="grid-2x2" id="slots-grid">
      <div class="slot-card">Loading microkernel slots...</div>
    </section>

    <section class="panel">
      <h2 class="sec-title">Service Bus Call Trace</h2>
      <div id="trace-list">No service calls yet.</div>
    </section>
  </main>

  <script>
    const OWNERS = {
      inventory: 'Slot 1 · Agent-Inventory (src/modules/inventory/)',
      orders: 'Slot 2 · Assigned to Codex (src/modules/orders/)',
      billing: 'Slot 3 · Assigned to OpenCode (src/modules/billing/)',
      audit: 'Slot 4 · Agent-Audit (src/modules/audit/)',
    };

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderDashboard(data) {
      const grid = document.getElementById('slots-grid');
      grid.innerHTML = data.slots.map((slot) => {
        const isStub = slot.status !== 'ACTIVE';
        const metricsHtml = slot.metrics.map((m) =>
          '<div class="metric"><div class="k">' + esc(m.label) + '</div><div class="v">' + esc(m.value) + '</div></div>'
        ).join('');

        return (
          '<article class="slot-card">' +
            '<div class="slot-head">' +
              '<div><h3>' + esc(slot.title) + '</h3><div class="slot-owner">' + esc(OWNERS[slot.slotId] || slot.slotId) + '</div></div>' +
              '<span class="badge ' + (isStub ? 'stub' : '') + '">' + esc(slot.badge) + '</span>' +
            '</div>' +
            '<p class="summary">' + esc(slot.summary) + '</p>' +
            '<div class="metrics">' + metricsHtml + '</div>' +
            '<div class="widget-box">' + slot.html + '</div>' +
          '</article>'
        );
      }).join('');

      const traceEl = document.getElementById('trace-list');
      if (!data.serviceCallLog || data.serviceCallLog.length === 0) {
        traceEl.textContent = 'No service calls recorded yet.';
      } else {
        traceEl.innerHTML = data.serviceCallLog.slice().reverse().map((c) => {
          const cls = c.mode === 'ACTIVE' ? 'mode-active' : 'mode-mock';
          return '<div class="trace-item"><span>' + esc(c.slotId + '.' + c.method + '()') + '</span><span class="' + cls + '">' + esc(c.mode) + '</span></div>';
        }).join('');
      }
    }

    async function loadDashboard() {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      renderDashboard(data);
    }

    document.getElementById('place-order-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('action-status');
      statusEl.className = 'status-msg';
      statusEl.textContent = 'Executing ctx.services.orders.createOrder(...)';

      const payload = {
        customer: document.getElementById('customer-input').value,
        sku: document.getElementById('sku-select').value,
        qty: Number(document.getElementById('qty-input').value),
        taxRate: Number(document.getElementById('tax-input').value),
      };

      const res = await fetch('/api/workflow/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.className = 'status-msg err';
        statusEl.textContent = data.error || 'Workflow error';
        return;
      }

      statusEl.className = 'status-msg ok';
      statusEl.textContent = 'Created ' + data.order.orderId + ' · Total $' + Number(data.order.totalAmount).toFixed(2);
      renderDashboard(data.dashboard);
    });

    document.getElementById('restock-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('action-status');
      const sku = document.getElementById('sku-select').value;
      const res = await fetch('/api/modules/inventory/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, qty: 5 }),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.className = 'status-msg err';
        statusEl.textContent = data.error || 'Restock failed';
        return;
      }
      statusEl.className = 'status-msg ok';
      statusEl.textContent = 'Restocked ' + sku + ' (+5)';
      await loadDashboard();
    });

    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        document.getElementById('kernel-health').textContent =
          'Active: ' + h.activeSlots.join(', ') + ' | Stubs: ' + (h.stubSlots.join(', ') || 'None');
      })
      .catch(() => {
        document.getElementById('kernel-health').textContent = 'Kernel Offline';
      });

    loadDashboard();
  </script>
</body>
</html>`;

export async function createErpServer({ dbPath = DEFAULT_DB_PATH } = {}) {
  const kernel = await createKernel({ dbPath });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/api/health') {
        const activeSlots = [];
        const stubSlots = [];
        for (const [slotId, status] of Object.entries(kernel.ctx.slotStatus)) {
          if (status === 'ACTIVE') activeSlots.push(slotId);
          else stubSlots.push(slotId);
        }
        sendJson(res, 200, {
          ok: true,
          app: 'Multi-Agent Microkernel ERP Workbench',
          activeSlots,
          stubSlots,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const dashboard = await kernel.getDashboard();
        sendJson(res, 200, dashboard);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/workflow/order') {
        const body = await readJsonBody(req);
        const order = await kernel.services.orders.createOrder(body);
        const dashboard = await kernel.getDashboard();
        sendJson(res, 200, { order, dashboard });
        return;
      }

      const moduleMatch = url.pathname.match(/^\/api\/modules\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
      if (moduleMatch && (req.method === 'GET' || req.method === 'POST')) {
        const [, slotId, action] = moduleMatch;
        const body = req.method === 'POST' ? await readJsonBody(req) : {};
        const query = Object.fromEntries(url.searchParams.entries());
        const result = await kernel.handleModuleRoute(slotId, req.method, action, body, query);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(WORKBENCH_HTML);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 400;
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, statusCode, { error: message });
    }
  });

  server.kernel = kernel;
  return server;
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  const port = Number(process.env.PORT) || 3095;
  const server = await createErpServer();
  server.listen(port, () => {
    console.log(`Multi-Agent Microkernel ERP Workbench running at http://localhost:${port}`);
  });
}
