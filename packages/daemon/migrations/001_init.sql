-- XBT accumulation bot (Neoxa Exchange): config, state and order log.
CREATE TABLE IF NOT EXISTS neoxa_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'DRY_RUN',
  pair TEXT NOT NULL DEFAULT 'BTCB2_BTC',
  budget_btc REAL NOT NULL DEFAULT 0,
  chunk_xbt REAL NOT NULL DEFAULT 0.25,
  post_only INTEGER NOT NULL DEFAULT 1,
  tiers_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS neoxa_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  spent_btc REAL NOT NULL DEFAULT 0,
  bought_xbt REAL NOT NULL DEFAULT 0,
  open_order_id TEXT,
  open_order_price REAL,
  open_order_qty REAL,
  open_order_placed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS neoxa_orders (
  order_id TEXT PRIMARY KEY,
  placed_at INTEGER NOT NULL,
  pair TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL NOT NULL,
  filled REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  tier INTEGER,
  note TEXT
);
