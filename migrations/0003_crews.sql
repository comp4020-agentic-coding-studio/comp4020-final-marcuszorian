-- Crews: a small, named, invite-joined group. One per user, so membership is
-- a column rather than a join table. See doc/adr/0011-crews.md, which argues
-- the social-layer reversal this represents rather than letting README.md's
-- "no following" claim quietly go false.
CREATE TABLE crews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE, -- randomUUID(), same as users.token
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,                 -- NULL = no time limit
  max_joins    INTEGER,              -- NULL = no cap
  -- Joins EVER, not current membership. If five people join and three later
  -- leave for another crew, live membership is two and this is still 5: the
  -- link's expiry is a property of the link's own history. The other
  -- question is `SELECT COUNT(*) FROM users WHERE crew_id = ?`, and both are
  -- used — this one gates the invite, that one is what the crew panel shows.
  -- They look interchangeable and are not.
  join_count   INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN crew_id INTEGER REFERENCES crews(id);

-- Every ghost read for a crew member filters on this, on both the HTTP route
-- and the live socket.
CREATE INDEX idx_users_crew ON users(crew_id);
