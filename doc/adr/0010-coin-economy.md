# 0010. Coins are paid for a closed day's rank, and spent on car trim

Status: accepted

Supersedes nothing. It builds directly on
[0009](0009-leaderboard.md) (which defines the one ranking order this pays
against), depends on [0006](0006-past-days-are-read-only.md) (which is what
makes a past day safe to pay out at all), and is bounded by
[0003](0003-visual-direction.md)'s colour grammar.

## Context

The round asks for coin rewards tied to leaderboard placement, and for coins
to unlock car skins. Both halves land on decisions this project has already
made, and the interesting work is in not quietly contradicting them.

**There has to be one ranking.** ADR 0009's whole argument against the old
unranked roster was that a second, undeclared ranking is worse than an honest
one. A payout computed server-side from its own `ORDER BY` would be exactly
that: a player could read "7th" off the panel and be paid 8th's coins because
two queries disagreed about a tie. `standings()` in
`client/src/leaderboard.ts` is already "the single definition of that order",
so the payout reads it rather than restating it.

**There is no scheduler.** `fly.toml` runs one machine that stops when idle.
Nothing wakes up at midnight UTC to close the day's books, and nothing is
going to — adding a scheduler is a deployment change for a feature that does
not need one.

**A day's result is not final until the day is over.** Paying a rank the
moment a run lands would pay a position that a later run the same day can
still take away.

Three questions follow, and this record answers them.

## Decision

### Settlement is lazy, idempotent, and driven by ordinary traffic

A row in a new `app_state` table holds `settled_through`: the last UTC date
whose payouts are done. `settleDue()` runs at the top of the API router. It
reads that one row first, and on all but the first request after a rollover
that read is the entire cost.

When there is catching up to do, it walks every day with recorded runs that is
strictly before today and after `settled_through`, pays each, and advances the
marker to yesterday. If the machine was asleep for three days, the next real
request settles all three in one pass.

This is only safe because of ADR 0006: a past day's `best_runs` rows are
immutable the instant the day stops being today, so there is no race to beat
and no window in which a settled day can change underneath its own payout.
`todayUtc()` already draws that line for reads; this extends the same line to
a write.

**Idempotence is the primary key, not a flag.** `coin_payouts` is keyed
`(track_seed, user_id)`, and a credit happens only when the insert actually
inserts a row. Running settlement twice over the same day inserts nothing and
credits nothing — the same way `best_runs`' own composite key already rules
out a duplicate run. A crashed, half-finished settlement re-runs safely,
because the days it already paid refuse to be paid again.

### The curve is `coins = 110 - rank * 10`, ranks 1–10

100 coins for first down to 10 for tenth; nothing at eleventh. It matches the
panel's existing `TOP_N = 10` cut, so the set of people who see themselves on
the leaderboard is exactly the set who get paid, and it is a one-line retune
with no schema change if it turns out wrong.

### Ties are already decided, and are not re-decided here

ADR 0009 fixed ties as alphabetical with sequential ranks, and named that as
the weakest part of itself. This record does not reopen it. The payout reads
the ranks `standings()` assigns, so a player who sees "7th" on the panel is
paid exactly 7th's coins. There is no split, no shared pot, and no second
opinion about who was ahead. If 0009's tie rule is ever revisited, the payout
follows it without being touched.

### Skins are car trim only, inside the existing palette

Two of `palette.ts`'s sixteen tokens are off-limits at any price, because the
file's own comments already assign them a meaning a skin would collide with:

- **`red`** — "crash, danger, obstacles". The hitbox in `car.ts` is real, not
  cosmetic, and a player trimmed in hazard-red reads as an obstacle at a
  glance.
- **`lavender`** — "ghost cars". `setPlayerGhostly` repaints the player
  lavender the moment they crash; a lavender skin would make "driving" and
  "just died" look identical.

That leaves eight trim colours: **magenta** (the default, free, and
deliberately never a row in `skins`), and **cyan, gold, orange, pink, violet,
mint and laserCyan** as the seven that cost something. The build plan called
this "eight real unlockable trim colours"; it is eight colours of which seven
are unlockable, because magenta is the one you already have.

**A skin's id is its palette token key.** Not an invented slug: the id `gold`
*is* `palette.gold`, so there is no table mapping skin names to colours that
can drift out of step with `palette.ts`. The display name is free to be
evocative; the identity is not.

A skin paints only the solid, driving car. `setPlayerGhostly`'s swap to
lavender-and-translucent is untouched, so the instant you crash your skin is
invisible and you look like every other ghost. That is the existing rule
holding, not a regression.

## Alternatives considered and ruled out

**Eager payout, at the moment a run lands.** No `app_state`, no walk, no
catch-up — by far the simplest thing that could work. Rejected because it pays
a rank that is not final: the day is still open, and the next run can displace
the player who was just paid for the position. Clawing coins back afterwards
is worse than not paying early.

**A scheduled job at 00:00 UTC.** The obvious shape, and wrong for this
deployment. The machine stops when idle, so the job either does not fire or
forces the machine to stay up for the sole purpose of firing it. Lazy
settlement gets the same result from traffic that was going to arrive anyway.

**A second, server-side ranking query.** Tempting, because `lib/` importing a
file out of `client/src/` looks backwards. Rejected on ADR 0009's own
reasoning. `standings()` is a pure function over `{username, distance}` and
the only DOM-touching export in that file is a class whose constructor never
runs unless something instantiates it, so the module evaluates cleanly under
plain Node.

**Level skins as well as car skins.** Considered and dropped. Every level
surface in this scene — road, grid, mountains, sun, sky — is carrying an
argument from ADR 0003, and a player-chosen repaint of them is a much larger
change to the visual direction than a trim colour is.

**Crew-scoped payouts.** Deferred to, and refused by,
[0011](0011-crews.md): coins stay global.

## Consequences

- `migrations/0002_coins.sql` adds `users.coins` and `users.equipped_skin`,
  and the `coin_payouts`, `skins`, `user_skins` and `app_state` tables. The
  seven purchasable skins are seeded in the migration, so the catalogue is
  schema, not configuration.
- **The runtime image now carries `client/src/`.** `src/server/lib/coins.ts`
  imports `standings()` from it, and the `Dockerfile`'s runtime stage
  previously copied only `src`, `migrations` and the built `dist`. Without
  that line the server typechecks, passes every local test, and crashes on
  boot in production. The one-directional alternative — move `standings()` to
  a third shared location — was not taken, because `leaderboard.ts` is where
  the rule is argued and splitting the rule from its argument is how the two
  drift apart.
- Domain logic lives in `lib/coins.ts` and `lib/skins.ts` as functions taking
  a `Database` rather than importing the singleton. That is what lets
  `spec/coins.test.ts` settle a *past* day against a throwaway database —
  something no HTTP test can do, because ADR 0006 correctly refuses to let
  anyone write a run to a past day over the API.
- Every unlock, equip and settled payout is logged by username on stdout,
  which is what `flyctl logs` reads.
- The `/api/ghosts` limit of 50 bounds the panel but **not** the payout:
  settlement reads the full, unlimited row set for the day. The panel is
  truncated; the money is not.
