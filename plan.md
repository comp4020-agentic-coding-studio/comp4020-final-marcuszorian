# nightly build: build plan

Living task list. Sections 1–5 are the 3-lane arcade runner mechanical overhaul; section 6 is the C9 real-time work. Supersedes the previous visual-direction plan; not a spec (that's the course's), not a decision record (those are in `doc/adr/`).

---

## 1. Overview & Core Philosophy

This overhaul pivots the game from continuous analogue steering with curve drift into a crisp, high-speed **three-lane arcade runner** (in the spirit of *Subway Surfers* and *Audiosurf*).

### What Stays Invariant
* **The Hauntological Archive**: The visual aesthetic (dark `#0D0221` base, ACES tonemapping, bloom, banded sun, ground grid, wireframe mountains, and archive aging) remains intact.
* **Presence over Leaderboards**: Traces remain objects you drive past in 3D space, not numbers on an abstract ranking table.
* **Deterministic Daily Seed**: Every UTC date generates an identical, reproducible track configuration shared by all clients.
* **Zero New Dependencies**: Continues to rely strictly on `three@0.182.0` vendored addons and hand-rolled PRNGs.

---

## 2. Requirements Specification

### Lane Mechanics & Input
* **Three Discrete Lanes**: Left (`-1`), Center (`0`), and Right (`+1`).
* **Input Handling**: Strict single-tap triggers (`Left` / `A` and `Right` / `D`). Each keypress shifts exactly one lane; holding the key down does not repeatedly shift lanes (`e.repeat` is ignored).
* **Movement Feel**: A fast, smooth slide (~120ms lerp) between lane centers.
* **Active Hitbox**: The vehicle hitbox remains active during the slide (clipping an obstacle mid-transition triggers a crash). The car model dynamically banks/rolls in the direction of the slide.

### Road & Visual Layout
* **Centerline**: Straight road (`x = 0` for all distances); road curvature drift is eliminated.
* **Lane Dividers**: Two dashed neon divider lines splitting the road surface into three distinct lanes, plus glowing cyan outer road boundaries.
* **Scenery Parallax**: Ground grid, wireframe mountains, and banded sun maintain their forward scrolling and horizon anchoring.

### Obstacle Generation & Looping Sets
* **Strict Solvability**: Every obstacle row contains either 1 or 2 blocked lanes—**never all 3**, guaranteeing at least one open lane.
* **Curated Pattern Library**: A catalogue of 15–20 distinct obstacle gate patterns (e.g., single barriers, double-lane clamps, alternating slaloms, zig-zags).
* **Seeded Looping Sequence**: The UTC day seed deterministically shuffles and sequences these patterns into an extended playlist that repeats once completed.
* **Lane-Filling Barriers**: Obstacles are rendered as rectangular red neon hazard barriers spanning the full lane width.

### Speed Scaling & Reaction Window
* **Continuous Speed Ramp**: Velocity smoothly accelerates with distance from a base cruising speed toward a challenging max ceiling.
* **Dynamic Reaction Spacing**: The longitudinal distance between consecutive obstacle gates expands slightly with speed, preserving a fair human reaction window (~300–400ms minimum) rather than becoming physically impossible.

### Ghost Compatibility
* **Coordinate Snapping**: Past runs recorded with continuous float lane coordinates snap to the nearest discrete lane (`-1`, `0`, or `+1`), allowing all historical ghosts to sit cleanly within lanes without resetting the database.

---

## 3. Hard Constraints

1. **Deterministic Reproducibility**: `(seed, distance) → obstacles` must remain a pure function so all clients and ghosts agree on placements.
2. **Strict Solvability**: Obstacle generator must assert that no row ever spawns 3 obstacles.
3. **Zero New Dependencies**: No external animation or physics libraries; implement the ~120ms slide with a simple delta-time lerp.
4. **Shaders as Template Strings**: Maintain inline GLSL strings without introducing custom bundler loaders.
5. **Preserve Harness Invariants**: Keep all required DOM IDs in `client/index.html` intact (`#score`, `#crashed`, `#restart`, etc.), and maintain `/` (200) and `/readme/` contract tests.

---

## 4. Implementation Phases

### Phase 1: Architectural Decision Record
- [x] Write `doc/adr/0004-discrete-three-lane-runner.md` before touching code. It supersedes
      nothing: ADR 0002's data model is untouched, and ADR 0003 already said a change
      touching the centerline should be a new record. Corrected from the original
      "superseding ADR 0002".
- [x] Document context, alternatives ruled out, and ghost snapping consequences.

### Phase 2: Track & Obstacle Architecture (`client/src/track.ts`)
- [x] Flatten road centerline (`centerXAt = 0`, `driftFor = 0`).
- [x] Define discrete lane width and lane centers (`-laneWidth`, `0`, `+laneWidth`).
- [x] Implement catalogue of 15–20 curated obstacle patterns with strict solvability (1 or 2 blocked lanes, never 3).
- [x] Implement seeded deterministic pattern sequencer that loops continuously.
- [x] Implement dynamic longitudinal gate spacing scaling with speed.
- [x] Update obstacle geometry and materials to lane-filling rectangular red neon hazard barriers.
- [x] Update road surface shader with two dashed neon divider lines.

### Phase 3: Discrete Car Physics & Controls (`client/src/car.ts`, `client/src/camera-rig.ts`)
- [x] Add discrete lane state (`currentLane`, `targetLane`, `transitionTimer`).
- [x] Implement single-tap keydown handling (ignoring `e.repeat`).
- [x] Implement ~120ms smooth slide interpolation between lanes.
- [x] Continuous distance-based speed ramp curve.
- [x] Continuous bounding-box collision detection against lane-filling barriers during transitions.
- [x] Link vehicle roll/banking to slide velocity.

### Phase 4: Ghost Backward Compatibility (`client/src/ghosts.ts`)
- [x] Snap legacy continuous `lane` floats to the nearest discrete lane index (`-1`, `0`, `+1`).
- [x] Update ghost meshes to match lane width and visual styling.

### Phase 5: Verification & Polish
- [x] `pnpm typecheck` clean (0 errors).
- [x] `pnpm test` passing (8/8 tests).
- [x] `pnpm check:evidence` passing.
- [x] Browser smoke test: verify lane responsiveness, collision accuracy, obstacle solvability, speed progression, and ghost rendering.

---

## 6. Real-time ghosts (C9)

A run that ends anywhere reaches every open session watching that day inside a
second, with no reload. The behavioural decision — a run is private while it
happens, public once it ends and only if it improved — is
`doc/adr/0005-realtime-ghosts.md`.

Note on "Zero New Dependencies" (§3 constraint 3): that constraint is about the
client — no animation or physics library for work a few lines can do. `ws` is a
server dependency that ADR 0001 named a month ago when it chose Node over Astro
precisely to keep it available. Adding it is the plan being followed, not
broken.

- [x] `doc/adr/0005-realtime-ghosts.md`: the decision, the two options refused, what it costs.
- [x] `events.ts`: turn the `scoreChanged()` no-op into a real in-process topic. `runs.ts` unchanged.
- [x] `lib/live.ts`: `ws` server at `/live`, per-connection day subscription, heartbeat to reap dead sockets.
- [x] `index.ts`: explicit `http.Server` so the socket has something to attach to.
- [x] `net.ts`: `LiveFeed` — one socket, re-subscribe on day change, jittered reconnect backoff.
- [x] `ghosts.ts`: render from push; polling demoted to the fallback while the socket is down.
- [x] `spec/realtime.test.ts`: the spec line under test, plus cross-day isolation, backfill, and improvement-only.
- [x] Verify in two real browsers with separate cookie jars, not two tabs of one.

---

## 7. Coin economy & car skins

Coin rewards for leaderboard placement, with skins as the coin sink. Answers
two of this round's four requested features directly ("add coin rewards for
leaderboard placement"; "coins can be used to unlock car ... skins" — level
skins were considered and dropped, see the palette note below).

This sits on top of ADR 0009's leaderboard, which already did the hard part: a
payout needs one authoritative order, and `standings()` in
`client/src/leaderboard.ts` is already "the single definition of that order"
(furthest first, alphabetical tiebreak, sequential ranks). Reusing it here
rather than writing a second ranking rule server-side is the point — ADR
0009's whole argument against the old unranked roster was that a second,
undeclared ranking is worse than an honest one.

### Why this needs `doc/adr/0010-coin-economy.md` before any migration
New columns on `users`, two new tables, and a reward rule that touches ADR
0006 ("a day closes at midnight") and ADR 0009 ("ranks are sequential,
alphabetical tiebreak") is a data-model and behavioural change by this repo's
own rule (`CLAUDE.md`: read the ADRs "before changing the stack, storage or
data model"). Three questions the record has to settle, with the answer this
plan proposes against each:

- **When does a day's payout happen, with no scheduler and a machine that
  stops when idle (`fly.toml`)?** **Lazy, idempotent settlement.** ADR 0006
  already makes a past day's `best_runs` immutable the instant it stops being
  today, so there's no race to beat — a small `app_state` row tracks
  `settled_through` (a date), and the next API request after rollover walks
  every unsettled day up to yesterday and pays it, same shape `todayUtc()`
  already uses for reads, extended to a write. If the machine was off for
  three days, the next real request catches up on all three in one pass.
- **What's the curve?** `coins = 110 - rank * 10` for ranks 1–10 (100 down to
  10), nothing below. Matches the panel's existing `TOP_N = 10` cut and is
  trivial to retune without a schema change.
- **Ties?** Already decided by ADR 0009 — a player who sees "7th" on the panel
  earns exactly 7th's coins, because the payout reads the same ranks the panel
  shows, not a second computation of them.

### Data model (`migrations/0002_coins.sql`)
```sql
ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN equipped_skin TEXT REFERENCES skins(id);
-- NULL equipped_skin means the free default magenta trim — nothing to unlock,
-- so it is never a row in `skins`.

CREATE TABLE coin_payouts (
  track_seed TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  rank       INTEGER NOT NULL,
  coins      INTEGER NOT NULL,
  settled_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (track_seed, user_id)
);
-- The primary key is what makes settlement idempotent: running it twice over
-- the same day inserts nothing new, the same way best_runs' own key already
-- rules out a duplicate.

CREATE TABLE skins (
  id   TEXT PRIMARY KEY,  -- slug, e.g. 'laser-trim'
  name TEXT NOT NULL,
  cost INTEGER NOT NULL
);

CREATE TABLE user_skins (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skin_id     TEXT NOT NULL REFERENCES skins(id),
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, skin_id)
);

CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL); -- holds 'settled_through'
```

### Skin palette constraint (your decision: car skins only, inside the existing palette)
Two of the sixteen `palette.ts` tokens are off-limits regardless of price,
because the file's own comments already assign them a meaning this feature
must not collide with:
- **`red`** — "crash, danger, obstacles". A player skinned hazard-red would
  read as an obstacle at a glance, and the hitbox (`car.ts`) is real, not
  cosmetic.
- **`lavender`** — "ghost cars — the vaporwave inflection" (ADR 0003). The
  moment a player crashes, `setPlayerGhostly` already repaints them lavender;
  a lavender skin would make "driving" and "just died" look identical.

That leaves magenta (default, free), cyan, gold, orange, pink, violet, mint,
laserCyan — eight real unlockable trim colours without touching ADR 0003's
colour grammar. Skins affect only the solid, driving car: `setPlayerGhostly`'s
swap to lavender-and-translucent on crash is untouched, so a skin is invisible
the instant you become a ghost — the existing rule, not a regression.

### Phase 1: Decision record
- [x] `doc/adr/0010-coin-economy.md`: the three questions above, their
      answers, and the alternative ruled out — eager per-run payout, rejected
      because it pays a rank a later run the same day can still displace,
      since the day isn't closed yet.

### Phase 2: Server (`migrations/0002_coins.sql`, `src/server/lib/coins.ts`, `src/server/routes/skins.ts`)
- [x] The migration above.
- [x] `lib/coins.ts`: `settleDue()`, reusing `standings()` imported from
      `client/src/leaderboard.ts` against the full, unlimited row set for each
      unsettled day (not the UI's `LIMIT 50`) — one ranking definition for the
      panel, the road, and the payout. Safe to import server-side: `standings`
      is a pure function and `Leaderboard` (the only DOM-touching export in
      that file) is a class whose constructor never runs unless instantiated,
      so nothing in it executes under plain Node.
- [x] Call `settleDue()` at the top of the API router — an `app_state` read
      first, so the expensive walk only runs on the day it has catching up to
      do.
- [x] `GET /api/me` grows `coins` and `equippedSkin` alongside `username`.
- [x] `routes/skins.ts`: `GET /api/skins` (catalogue plus owned/equipped flags
      for the caller); `POST /api/skins/:id/unlock` (one transaction,
      check-and-deduct — can't go negative, can't double-charge a repeat
      unlock); `POST /api/skins/:id/equip` (403 if not owned — exactly the
      "can one user touch state that isn't theirs" check Crit 10's spec names).
- [x] Log every unlock, equip, and settled payout server-side, by username —
      Fly captures stdout, and Crit 10 explicitly asks for "who did what,
      server-side" read back over `flyctl logs`.

### Phase 3: Client
- [x] `car-model.ts`: `createPlayerCar()` takes a trim colour (default
      magenta); add `setPlayerTrim(group, color)` beside the existing
      `setPlayerGhostly` swap.
- [x] A small skins panel, reusing the `.panel`/`details` pattern `#leaderboard`
      already has: catalogue, coin balance, unlock/equip per entry.
- [x] `net.ts`: `getSkins()`, `unlockSkin()`, `equipSkin()`.

### Phase 4: Verification
- [x] `spec/coins.test.ts`: a day's top-10 pays out once it's past, not
      before; settling twice doesn't double-pay; 11th place earns nothing; a
      tie pays the rank `standings()` assigns, never a split.
- [x] `spec/skins.test.ts`: unlock without enough coins is refused; a repeat
      unlock doesn't charge twice; equipping an unowned skin is refused.
- [x] Browser smoke test: equip a non-default trim, crash, confirm the car
      reads as lavender exactly like any other ghost.

### What shipped differently from the above
Recorded rather than quietly absorbed, same habit as the ADRs:

- **`spec/coins.test.ts` runs against a throwaway database, not over HTTP.**
  Forced, not a shortcut: the whole subject is a day that is already *closed*,
  and ADR 0006 correctly refuses to let anything write a run to a past day
  over the API. `lib/coins.ts` and `lib/skins.ts` therefore take a `Database`
  rather than importing the singleton. `spec/skins.test.ts` covers the HTTP
  permission surface, where it belongs.
- **The skins catalogue lives in the migration, not in config.** Which colours
  are purchasable is an ADR 0003 decision (`red` and `lavender` are
  off-limits), and a skin's id *is* its `palette.ts` token key — so no table
  maps a skin to a hex value and nothing can drift.
- **`spec/trim.test.ts` was added**, beyond the plan: ADR 0010 claims a skin
  is invisible the instant you crash, and that claim is one swapped material
  away from being false. It is pinned rather than only eyeballed.
- **The `Dockerfile` now copies `client/`.** `lib/coins.ts` imports
  `standings()` from `client/src/leaderboard.ts`, which makes `client/` a
  *runtime* dependency of the server. Without that line the image typechecks,
  passes every local test, and dies on boot. Verified by running the spec
  against the built image, not just locally.

---

## 8. Crews & invite links

Shareable invite links, so you can "verse groups of friends" — the fourth
requested feature, and the one with the most to answer for against this
project's own history.

### This reopens an argument the project already had, twice
`README.md`'s "What this doesn't mean" line is explicit: **"no social layer —
no names you recognize going in, no following, no messaging."**
`doc/adr/0005-realtime-ghosts.md` refused a presence counter on the same
grounds. `doc/adr/0009-leaderboard.md` already walked back the bigger half of
that promise once, and said so plainly: *"Ghosts are no longer the only way to
meet other players... only the only way to meet them in space."*

A crew — a small, named, invite-joined group whose members you can tell apart
from strangers on the road — **is** a social layer in the sense that sentence
rules out. Shipping it without saying so would leave a stale, false claim
sitting in the README exactly the way ADR 0006 and ADR 0009 both refused to.
So this gets `doc/adr/0011-crews.md`, in the same honest register as 0009:
what it decides, and what it costs, named plainly.

What the record has to own:
- **"No following" stops being true.** A crew is standing membership, not a
  one-off ghost encounter — closer to following than anything this app has
  shipped. The bullet needs rewriting, not deleting: "no messaging" and "no
  names you recognize going in" can still stand; only the membership half is
  now false.
- **It's also the first time this project does what README's "good means"
  section argued *for* all along** — "built for people who'll actually
  recognize each other's presence, not an anonymous crowd" — more literally
  than the global leaderboard ever did. Worth stating as the case *for* it,
  not only the cost.

### Design, resolved against your answers
- **One active crew at a time.** `users.crew_id` directly, no join table —
  joining a new link overwrites it. Matches the existing one-row-per-user
  shape (one `token`, one `equipped_skin`, now one `crew_id`).
- **An invite link expires on count or time, whichever comes first.**
  `crews.max_joins` and `crews.expires_at` are both nullable; a join is
  refused once either is hit — itself a genuine server-side permission check,
  the kind Crit 10's spec is built to test.
- **Coins stay global-only** (your answer): `settleDue()` reads the plain,
  unfiltered `best_runs` for the day, the same query `ghosts.ts`/`live.ts`
  already run — never the crew-scoped view below. Worth a comment at the
  query site saying so, because it's exactly the kind of thing a later edit
  could "fix" by mistake.
- **Road ghosts become crew-only the moment you're in a crew** (your answer,
  stricter than either option originally offered — recorded as what was
  actually decided, not a rounded-off version). Crew-less stays exactly as
  today; joining narrows `GET /api/ghosts?seed=` and the live feed's
  per-connection set to `users.crew_id = you.crew_id`, unconditionally, no
  opt-out. The sharpest version of "the ghost is for someone," not a softened
  one.
- **The leaderboard panel stays switchable, global ↔ crew** (your answer) —
  which means, plainly: **the panel and the road no longer agree on who's on
  the day**, for a crew member. `main.ts`'s own comment currently says the
  opposite is load-bearing: *"The leaderboard reads the same ghost set the
  scene draws, so the panel and the road can never disagree about who is on
  this day."* This plan deliberately breaks that invariant for crew members,
  and the comment has to be rewritten to say so rather than quietly go stale.

### Mechanical details worth settling now
- **The `/live` socket needs to know who's asking.** The WebSocket handshake
  carries the same `token` cookie an HTTP request would (`wss.on('connection',
  (socket, request) => ...)` — `request.headers.cookie` is there). Generalize
  `auth.ts`'s cookie-parsing half to accept a raw header string so
  `requireAuth` and the live handshake share one definition of "who does this
  cookie belong to," rather than growing a second. A signed-out connection has
  no crew and sees the global feed, same as today.
- **`join_count` counts total joins ever, not current membership.** If five
  people join and three later leave for another crew, live membership is two
  but the invite is still "used 5 times" for `max_joins` — the link's expiry
  is a property of its own history, not a live headcount (`SELECT COUNT(*)
  FROM users WHERE crew_id = ?` answers the other question, if ever needed).
  Worth a schema comment: the two numbers look interchangeable and aren't.
- **A link is a path, not a query param** (`/crew/<token>`), handled
  client-side: `main.ts` checks `location.pathname` on load, joins once an
  account exists (queuing the join while the username modal is still open,
  the same deferred-until-signed-in shape `postRunEnd` already uses), then
  `history.replaceState`s back to `/` so a refresh can't double-join.
- **Joining triggers a re-subscribe**, exactly like a day change already does
  (`ghostLayer.setSeed` → `live.subscribe`) — otherwise a mid-session join
  would need a reload to show the narrower ghost set, the one thing C9
  promised never to require.

### Data model (`migrations/0003_crews.sql`)
```sql
CREATE TABLE crews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,              -- NULL = no time limit
  max_joins    INTEGER,           -- NULL = no cap
  join_count   INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN crew_id INTEGER REFERENCES crews(id);
```

### Phase 1: Decision record
- [x] `doc/adr/0011-crews.md`: the social-layer reversal argued honestly, the
      join-count-vs-membership distinction, and why road ghosts filter
      unconditionally while the leaderboard stays switchable.
- [x] Rewrite `README.md`'s "no social layer" bullet to match, in the voice
      ADR 0009's README edit used.
- [x] Update `main.ts`'s "panel and road can never disagree" comment at the
      point it stops being true.

### Phase 2: Server (`migrations/0003_crews.sql`, `src/server/routes/crews.ts`, `lib/live.ts`, `lib/auth.ts`)
- [x] The migration above. `invite_token` via `randomUUID()` — the exact
      precedent `auth.ts`'s `issueToken()` already set, zero new dependency.
- [x] `routes/crews.ts`: `POST /api/crews` (name, optional `maxJoins`,
      optional `expiresInSeconds`) → `{ inviteUrl }`; `GET /api/crews/:token`
      (name + open/closed, so the invite link can show something before
      joining); `POST /api/crews/:token/join` (401 signed out, 404 unknown,
      410 expired/full, 200 + sets `crew_id` and increments `join_count`
      unconditionally otherwise); `GET /api/crews/me`.
- [x] `ghostsRouter`: when the requester is authenticated with a `crew_id`,
      scope the `WHERE` to crew members; signed-out or crew-less is unchanged.
- [x] `lib/live.ts`: resolve the connecting socket's user/crew from its cookie
      at `connection` time; `ghostsFor(seed, crewId?)` takes the same scope;
      `onScoreChanged`'s broadcast loop only sends to a client whose crew
      matches the run's author's crew (or both have none).
- [x] Log crew creation and every join — accepted or refused, and why —
      server-side, again directly serving Crit 10's logging requirement.

### Phase 3: Client
- [x] `net.ts`: `createCrew()`, `getCrew(token)`, `joinCrew(token)`,
      `getMyCrew()`.
- [x] Boot-time invite handling in `main.ts`, per the mechanical details above.
- [x] A small crew panel: "no crew" + a create action, or your crew's name,
      member count, and a copyable invite link once in one.
- [x] `leaderboard.ts`: a global/crew tab (shown only once a crew exists) —
      the first place in the client that needs its own `seed`-scoped fetch
      independent of `GhostLayer`'s road-scoped one, since the two now
      disagree by design.

### Phase 4: Verification
- [x] `spec/crews.test.ts`: create, join, re-join replaces the prior crew; a
      join past `max_joins` is refused; a join past `expires_at` is refused;
      `join_count` keeps counting through a leave/rejoin elsewhere;
      `/api/ghosts` returns only crew members for a crew member and everyone
      for a non-member, from the same underlying `best_runs` rows.
- [x] `spec/realtime.test.ts` gains a case: two crew members see each other's
      finished runs live; a third party on the same day, outside the crew,
      does not.
- [x] Two-browser manual verification, the same separate-cookie-jar harness
      `PROCESS.md` already describes for C9: one browser creates a crew and
      shares the link, the other joins via the URL alone and sees the first's
      ghost appear within a second, with no reload. **Done — the second
      browser saw it in ~123ms, with the ghost car drawn on its road.**

### What shipped differently from the above
- **The broadcast rule is "does this client's scope include the author", not
  "do these two crews match".** The plan wrote the latter, which would stop a
  *crew-less* viewer from seeing a crew member's run live while
  `GET /api/ghosts` hands that same viewer that same run. The socket has to
  agree with the backfill, or reconnecting silently changes what you can see.
  Argued in ADR 0011's consequences, and pinned by a new `spec/realtime.test.ts`
  case.
- **`GET /api/ghosts` grew `?scope=global`.** The plan gave the leaderboard a
  global tab without giving it any way to ask for the whole day — a crew
  member's every read was crew-scoped. This is that escape hatch, and the road
  never passes it.
- **The socket resolves the viewer's crew per `subscribe`, not once per
  connection**, which is what lets a mid-session join narrow the road without
  a reload.
- **The duplicated ghost query was extracted to `lib/ghost-rows.ts`.** Two
  copies were tolerable while it took one argument; now that it takes a
  *scope*, two copies is two places to forget it.
- **`/crews/me` is registered before `/crews/:token`.** Express matches in
  order, and `me` is a perfectly good-looking invite token to a `:token`
  pattern — the other order answers every call with a 404 for an invite
  nobody created.

---

## How sections 7–8 answer the brief, not just the four bullets

- **Multi-user** gets sharper, not just bigger: a crew is a second, narrower
  kind of "the app tells them apart" (member vs. stranger, on top of signed-in
  vs. anonymous), and the skins unlock/equip boundary is exactly the
  server-enforced permission check Crit 10's spec names directly.
- **Real-time** stays true for the new surfaces: a crew join and a settled
  payout both need to reach the right session within a second, and both reuse
  the existing `scoreChanged`/`LiveFeed` seam rather than inventing a second
  one — the discipline ADR 0001 set up for C9, carried forward.
- **Persists**: coins, skins, crew membership, and invite-link state all live
  in the one SQLite file on the one Fly volume. No new storage, no new
  deployment shape, nothing `fly.toml` doesn't already cover.
- **"Add more games" is deliberately left out of this plan**, at your
  request — so it isn't half-built, competing for review time against the
  three features above.
