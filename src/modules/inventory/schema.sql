-- Inventory slot table (assigned to Agent-Inventory)
-- Table names must use the `inventory_` prefix.

CREATE TABLE IF NOT EXISTS inventory_items (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  available_qty INTEGER NOT NULL,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL
);
