-- A favorite trick (doc/adr/0018): equipping is per-row on user_tricks,
-- not a column on users like skins, because a trick's equip state only
-- makes sense attached to a row the player already owns. `equipTrick` keeps
-- at most one row at `equipped = 1` per user by unsetting the rest first.
ALTER TABLE user_tricks ADD COLUMN equipped INTEGER NOT NULL DEFAULT 0;
