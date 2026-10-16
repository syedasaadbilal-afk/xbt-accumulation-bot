-- Per-band interval windows (each DCA band can have its own interval length).
ALTER TABLE neoxa_state ADD COLUMN windows_json TEXT NOT NULL DEFAULT '{}';
