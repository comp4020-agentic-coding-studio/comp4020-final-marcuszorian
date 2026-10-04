# 0002. Best runs are keyed by (user, day), not (user) alone

Status: accepted

## Context

The game's core mechanic is a ghost: a translucent car at the spot where
another player crashed, visible on your own run. For a ghost to sit somewhere
meaningful, the road under it has to be the same road you're driving — so the
track is generated from a seed, and the natural seed is the current UTC date,
shared by every client with no server round-trip needed for the seed value
itself.

That raises a real data-model choice, independent of the stack choice in ADR
0001: what happens when the date rolls over? Three shapes were considered:

1. **One rolling best-ever score per user**, full stop. Simplest schema
   (`user_id` alone as the key). But then "the day" is only ever a rendering
   detail — yesterday's ghost either keeps appearing on a road that's since
   changed (meaningless placement) or has to be silently discarded, and
   there's no way to ever revisit or beat an old best once today's track
   looks different.
2. **A fresh track every day, old days simply gone** once the date rolls
   over — no way to see or race a past day's ghosts at all once it's not
   "today." Simple, but throws away exactly the thing that makes a date-seeded
   track interesting: there's a real, specific "last Tuesday" a player could
   go back to.
3. **Every best run keyed by `(user, day)`**, with the day itself a free
   parameter in both the read (`GET /api/ghosts?seed=`) and write
   (`POST /api/run-end {seed}`) paths — any past day stays visitable, and a
   player can replay it and try to beat that day's specific best.

## Decision

Option 3: `best_runs` has primary key `(user_id, track_seed)`. The track seed
is a free, validated parameter everywhere — not implicitly "always today."

```sql
CREATE TABLE best_runs (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  track_seed TEXT NOT NULL,
  distance   REAL NOT NULL,
  lane       REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, track_seed)
);
```

`POST /api/run-end` accepts an optional `seed` (defaults to today's UTC date;
validated as `YYYY-MM-DD` and not in the future — you can replay history, you
can't post against a day that hasn't happened). `GET /api/ghosts?seed=` and
the new `GET /api/days` (distinct seeds with any activity) both treat every
day symmetrically; nothing in the schema or API privileges "today" except the
client's default selection.

## Consequences

- "A stranger finds their trace when they come back" now has two real
  readings: trivially, later the same day; and more interestingly, weeks
  later, against a specific day they can still name and still try to beat.
  That's a more interesting answer to what *good* means for this app than a
  single leaderboard would have been, and it's the kind of thing worth saying
  so directly in `README.md`.
- No `days` table is needed yet — `SELECT DISTINCT track_seed FROM best_runs`
  answers "which days have activity." One would only be needed if a day ever
  carried its own metadata (a theme, a modifier) beyond the runs posted
  against it.
- This is a schema shape, decided before any real player data exists.
  Retrofitting a day dimension onto a live `(user_id)`-only table later would
  mean a real migration against production data — the kind of decision this
  course's own guidance flags as worth making deliberately up front rather
  than discovering the need for after the fact.
- The client-side day-selector *UI* for actually cycling through past days is
  explicitly allowed to lag behind this schema/API (see `plan.md`) — the
  point of deciding this now is that the UI can be built whenever there's
  time, without the data model changing underneath it.
