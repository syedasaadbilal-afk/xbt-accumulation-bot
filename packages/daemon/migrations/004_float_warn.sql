-- Warn in the dashboard when the BTC float on the exchange drops below this level.
ALTER TABLE neoxa_config ADD COLUMN float_warn_btc REAL NOT NULL DEFAULT 0.02;
