-- Accounts are lightweight: a username and an opaque token, no password.
-- Scores are kept per (user, day) rather than one rolling best-ever score —
-- see doc/adr/0002-daily-seeded-archive.md for why: it's what lets a player
-- come back to a past day and race its ghosts, not just today's.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE,
  token      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE best_runs (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  track_seed TEXT NOT NULL, -- UTC date, e.g. '2026-10-06'
  distance   REAL NOT NULL,
  lane       REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, track_seed)
);

CREATE INDEX idx_best_runs_seed ON best_runs(track_seed);
