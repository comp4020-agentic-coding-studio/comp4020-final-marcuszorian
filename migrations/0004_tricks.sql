-- Trick ramps: a coin-bought catalogue of input sequences, the same shop
-- pattern as skins (doc/adr/0010). See plan.md's "Shop & server" section —
-- owning a trick is the only state, there is no equip concept, so unlike
-- skins there is no `equipped_trick` column on `users`.

-- `sequence` is a JSON-encoded array of input tokens (e.g.
-- '["up","down","left"]'), stored as plain TEXT — the client owns parsing it,
-- the server just carries it through unchanged.
CREATE TABLE tricks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sequence     TEXT NOT NULL,
  bonus_metres INTEGER NOT NULL,
  cost         INTEGER NOT NULL
);

INSERT INTO tricks (id, name, sequence, bonus_metres, cost) VALUES
  ('tailwhip',   'tail whip',     '["up","down"]',             20, 100),
  ('superman',   'superman',      '["up","left","right"]',     40, 200),
  ('backflip',   'backflip',      '["down","down","up"]',      60, 320),
  ('barrelroll', 'barrel roll',   '["left","right","left"]',   85, 460),
  ('nightlybig', 'nightly spin',  '["up","left","down","right"]', 120, 650);

CREATE TABLE user_tricks (
  user_id     INTEGER REFERENCES users(id),
  trick_id    TEXT REFERENCES tricks(id),
  unlocked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, trick_id)
);
