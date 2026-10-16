-- Drawdown-scaled DCA strategy (reference = moving average of exchange candles).
ALTER TABLE neoxa_config ADD COLUMN strategy TEXT NOT NULL DEFAULT 'DCA';
ALTER TABLE neoxa_config ADD COLUMN dca_json TEXT NOT NULL DEFAULT '';

ALTER TABLE neoxa_state ADD COLUMN open_order_band REAL;
ALTER TABLE neoxa_state ADD COLUMN window_id INTEGER;
ALTER TABLE neoxa_state ADD COLUMN window_chunks REAL NOT NULL DEFAULT 0;
ALTER TABLE neoxa_state ADD COLUMN band_spent_json TEXT NOT NULL DEFAULT '{}';
