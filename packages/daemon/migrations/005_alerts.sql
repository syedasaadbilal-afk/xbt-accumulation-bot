-- Push alerts (ntfy): topic name acts as the secret; empty = alerts off.
ALTER TABLE neoxa_config ADD COLUMN alert_topic TEXT NOT NULL DEFAULT '';

ALTER TABLE neoxa_state ADD COLUMN last_float_alert_at INTEGER;
ALTER TABLE neoxa_state ADD COLUMN last_error_alert_at INTEGER;
