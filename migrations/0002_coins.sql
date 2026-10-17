-- Coins for a closed day's leaderboard rank, spent on car trim colours.
-- See doc/adr/0010-coin-economy.md for the three decisions this encodes:
-- settlement is lazy and idempotent, the curve is 110 - rank*10 for ranks
-- 1..10, and ties are whatever standings() already said they were.

-- The catalogue comes first: users.equipped_skin references it below.
--
-- `id` is deliberately a palette token key from client/src/palette.ts, not an
-- invented slug — the id 'gold' IS palette.gold. There is no table anywhere
-- mapping a skin to a hex value, so there is nothing to drift out of step
-- with the palette. `red` and `lavender` are absent on purpose: they already
-- mean "obstacle" and "ghost" (ADR 0003), and a car wearing either would read
-- as something it isn't. `magenta` is absent too — it is the free default,
-- and nothing you already have belongs in a shop.
CREATE TABLE skins (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL
);

INSERT INTO skins (id, name, cost) VALUES
  ('cyan',      'coolant cyan',  120),
  ('mint',      'mint signal',   180),
  ('orange',    'sodium orange', 240),
  ('pink',      'static pink',   300),
  ('violet',    'violet hour',   420),
  ('gold',      'gold standard', 600),
  ('laserCyan', 'laser white',   900);

ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
-- NULL means the free default magenta trim, which is why it is nullable and
-- why there is no 'magenta' row to point at.
ALTER TABLE users ADD COLUMN equipped_skin TEXT REFERENCES skins(id);

-- The primary key is what makes settlement idempotent — not a flag, and not a
-- check-then-insert. A credit happens only when the insert actually inserts,
-- so re-running settlement over a day that is already paid credits nothing,
-- the same way best_runs' own composite key already rules out a duplicate
-- run. A settlement that crashed half way through re-runs safely.
CREATE TABLE coin_payouts (
  track_seed TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  rank       INTEGER NOT NULL,
  coins      INTEGER NOT NULL,
  settled_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (track_seed, user_id)
);

CREATE TABLE user_skins (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skin_id     TEXT NOT NULL REFERENCES skins(id),
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, skin_id)
);

-- One row, 'settled_through' — the last UTC date whose payouts are done.
-- Read at the top of every API request, which on all but the first request
-- after a rollover is the entire cost of having no scheduler.
CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
