# Crit 8 ("It's alive!") — endless 3D driving game with daily, replayable ghosts

Living task list for this week's build. Updated as work lands; not a spec
(that's the course's), not a decision record (those are `doc/adr/`) — this is
the plan, checked off as we go.

## Context

First week of the final project. Due **Tue 6 Oct 2026, 12:00 Canberra time**.
This repo carries through to submission on 9 Nov, so the stack and data model
chosen here are the ones justified in A3.

Three parallel research agents compared Node+Express+SQLite, Astro (course
default), Django+Channels, and Phoenix LiveView against this specific game and
converged independently: **Node/Express/better-sqlite3**, because the real
decision factor is "which architecture doesn't block real-time later," not
"which framework has it built in" — Astro has no official WebSocket API
(unmerged proposal since 2023), and Phoenix LiveView's server-rendered-HTML-
diffing model fights a client-side canvas/3D game loop.

**The game**: an endless 3D driving game (Three.js). Drive until you crash;
your crash distance is your personal best *for the day you're racing*. Other
players' best-of-that-day crash points appear as translucent ghost cars on
your run, synced by polling (a few minutes' staleness is fine — confirmed).
The road is generated from a **UTC-date seed shared by every client**, so a
ghost at distance X sits on the same road geometry for everyone racing that
day.

**History/replay extension**: a new day starts fresh, but players can cycle
back to any past day, see that day's ghosts, and post a new run against it —
racing that day's high score rather than only ever playing "today." The data
model (`best_runs` keyed by `(user, day)`) already supports this; see
`doc/adr/0002-daily-seeded-archive.md`.

This two ways satisfies "a stranger can visit, do the core thing, and find
their trace still there when they come back": trivially (today's ghost greets
you later today), and more interestingly (come back next week and still find —
and race against — last Tuesday's version of you).

C8's bar is "proof of life" — the brief says the feature list, real-time
layer, and polish can all wait. This plan is sized to that; see **Out of
scope** below for what's deliberately deferred.

## Decisions

- [ ] `doc/adr/0001-stack.md` — Node/Express/better-sqlite3/Three.js, citing
      Astro/LiveView/Django+Channels as ruled out and why.
- [ ] `doc/adr/0002-daily-seeded-archive.md` — per-day best runs as a
      first-class, replayable unit, not a single rolling best-ever score.

## Schema (settled, see ADR 0002)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE best_runs (
  user_id INTEGER NOT NULL REFERENCES users(id),
  track_seed TEXT NOT NULL,         -- UTC date, e.g. '2026-10-06'
  distance REAL NOT NULL,
  lane REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, track_seed)
);
CREATE INDEX idx_best_runs_seed ON best_runs(track_seed);
```

## API

- `POST /api/account {username}` — no password; issues an httpOnly token
  cookie.
- `POST /api/run-end {distance, lane, seed?}` — `seed` optional (defaults to
  today's UTC date); if given, must be `YYYY-MM-DD` and not in the future.
  Auth required. Upserts only if it improves `(user_id, seed)`. Calls
  `scoreChanged()` (no-op today — the future-`ws` seam).
- `GET /api/ghosts?seed=` — best runs for that day. No auth.
- `GET /api/days` — distinct seeds with activity, newest first, always
  includes today.

## Task list

### Day 0 (today, Sun)
- [x] Plan approved, committed as this file.
- [ ] Paste `FLY_API_TOKEN` into `mise.local.toml` (from the course Ed
      message) — needed for manual `flyctl deploy` while the repo is private.
      (CI's own `FLY_API_TOKEN` secret already exists — confirmed via
      `gh secret list`.)
- [ ] `doc/adr/0001-stack.md`, `doc/adr/0002-daily-seeded-archive.md`
- [ ] Minimal Express replacement: `/` → 200, `/readme/` → rendered
      `README.md`. No DB, no game yet.
- [ ] `db.ts` / `migrate.ts` / `migrations/0001_init.sql`
- [ ] New Dockerfile + `package.json` build scripts
- [ ] `docker build` + local run with throwaway `/data`, `pnpm check` green
- [ ] Manual `flyctl deploy`, confirm live URL answers; flip repo public;
      trigger `checks.yml` once

### Day 1 (Mon)
- [ ] `spec/ghosts.test.ts`, `spec/days.test.ts` (red)
- [ ] `/api/account`, `/api/run-end`, `/api/ghosts`, `/api/days`, `auth.ts`,
      `events.ts`, `seed.ts` — tests green, push
- [ ] Three.js skeleton: scene/camera/renderer, `track.ts`, `car.ts`, crash →
      `postRunEnd`
- [ ] Username-prompt → `postAccount`
- [ ] `ghosts.ts` polling + rendering, scoped to `selectedSeed`
- [ ] **Checkpoint**: if on schedule, `days.ts` day-selector UI; if not, defer
      to C9 (API/schema are not deferred, only the client control)
- [ ] Push, smoke-test live URL by hand

### Day 2 (Tue morning, before noon)
- [ ] Fix anything overnight CI surfaced
- [ ] `README.md` v1 ("what good means" + sources read)
- [ ] `PROCESS.md` (replace template, cite commits + both ADRs)
- [ ] `reflections/crit-8.md`
- [ ] `pnpm check` + `pnpm check:evidence` green locally
- [ ] Final push well before noon; confirm CI `check` + `deploy` green;
      update this file with what shipped vs deferred

## Out of scope for C8 (deferred to C9/C10/submission)

Real-time push (polling + the `scoreChanged()` seam only) · the day-selector
UI if the Day 1 checkpoint isn't reached (API/schema ship regardless) ·
visual/game-feel polish · full vehicle physics (lane-offset model only) ·
track variety beyond gentle seeded curves/obstacles · leaderboards beyond the
per-day ghost list · password/account recovery (token cookie only) · mobile/
touch controls · anti-cheat on `/api/run-end` · automated WebGL/visual E2E
testing (API-level tests are the deliberate proxy) · a migration framework ·
any second Fly app or external DB.
