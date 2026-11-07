-- Order size can be set in BTC (fixed spend per chunk, so more XBT at lower prices) or in XBT (fixed quantity).
ALTER TABLE neoxa_config ADD COLUMN chunk_unit TEXT NOT NULL DEFAULT 'XBT';
ALTER TABLE neoxa_config ADD COLUMN chunk_btc REAL NOT NULL DEFAULT 0;
