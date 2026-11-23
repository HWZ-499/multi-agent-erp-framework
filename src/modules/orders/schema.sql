-- Orders slot table (assigned to Codex / Agent-Codex-Orders)
-- Table names must use the `orders_` prefix.

CREATE TABLE IF NOT EXISTS orders_records (
  order_id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  subtotal REAL NOT NULL,
  tax_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  invoice_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
