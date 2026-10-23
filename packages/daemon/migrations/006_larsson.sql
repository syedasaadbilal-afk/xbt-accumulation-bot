-- Larsson Line tracker (paper only): config + the actual order-book price recorded at each signal.
CREATE TABLE IF NOT EXISTS larsson_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  paper_size_xbt REAL NOT NULL DEFAULT 0.25,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS larsson_fills (
  signal_bar_time INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('enter', 'exit')),
  actual_price REAL NOT NULL,
  size_xbt REAL NOT NULL,
  filled_at INTEGER NOT NULL,
  PRIMARY KEY (signal_bar_time, action)
);
