-- Inventory slot table (assigned to Agent-Inventory)
-- Table names must use the `inventory_` prefix.

CREATE TABLE IF NOT EXISTS inventory_items (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  available_qty INTEGER NOT NULL,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  order_id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
