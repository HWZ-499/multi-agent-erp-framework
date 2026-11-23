-- Billing slot table (assigned to OpenCode / Agent-OpenCode-Billing)
-- Table names must use the `billing_` prefix.

CREATE TABLE IF NOT EXISTS billing_invoices (
  invoice_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  customer TEXT NOT NULL,
  subtotal REAL NOT NULL,
  tax_rate REAL NOT NULL,
  tax_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
