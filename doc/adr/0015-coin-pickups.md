# 0015. Coin pickups are derived from gate rows, not an independent seeded timeline, and credit every run

Status: accepted

## Context

Concept art Asset 04 adds coin pickups in the Subway-Surfers style: short
trails of spinning coins that curve through the lane a player is already
steering toward. `track.ts` already has three independent seeded obstacle
timelines (barrier rows, moving-barrier rows, oil spills) plus a derived one
(ramps, paired to a specific barrier row per 0014). Coins need a fourth
`Obstacle` kind, and a way to credit the pickup to the coin economy 0010
already built.

## Decision

**A coin trail is derived from each gate row's already-decided open lane(s),
not its own seeded distance/lane draw.** `coinsThrough` walks `rowsThrough`'s
output directly: for every blocked row, every lane that row leaves open gets
a short trail of coins ending just before the gate, in that lane. This is
deliberately *not* a fifth independent timeline the way oil and ramps are —
there is nothing to seed, because the trail's distance and lane are both
already fixed facts about a row that exists regardless of coins. It also
means a coin trail can never appear somewhere `patternIsSolvable` hasn't
already proven reachable, with no new invariant to write or prove.

Oil and ramps each skip a lane coins would otherwise also claim (via
`oilNearLane`/`rampNearLane`), so the three non-fatal kinds never stack on
the same spot and blur into one unreadable obstacle.

**Coins are a real credit to `users.coins`, posted with `/api/run-end` and
applied unconditionally — not folded into `car.distance` the way a trick
bonus is (0013), and not gated on `improved` the way the leaderboard row is.**
A trick's bonus is indistinguishable from any other metre of distance once
it's logged; a coin pickup already has its own first-class meaning under 0010
(a thing the shop charges against) that distance never had before 0010
existed, so routing it as more distance would quietly re-derive currency from
a column that already has a currency column sitting right next to it. Credit
runs before the distance/`best_runs` branch in the same handler, so a crashed
run that didn't beat a personal best still keeps whatever coins it picked up
along the way — the inverse of 0010's own past-day settlement, where only a
*final* rank pays, because here there is no rank to beat, only a running
total.

**The client, not the server, counts the coins.** `car.ts`'s `stepCar` reports
`coinsCollected: number[]` (the `z` of each coin touched this frame,
deduplicated the same way `lastRampZ` already deduplicates a ramp), and
`main.ts` accumulates a run-scoped `runCoins` counter that rides along with
the existing `postRunEnd` call. This mirrors 0013's own precedent for trick
selection: the set of coins a run passes is a pure function of `(seed,
distance)`, so there is nothing non-deterministic for the server to second-
guess, and a server-side recount would mean duplicating `coinsThrough`
outside the client bundle for no reason — 0010's `coins.ts` already imports
`client/src/leaderboard.ts` into the server runtime where sharing logic
actually requires it; this doesn't.

**A generous server-side ceiling (`MAX_COINS_PER_RUN`), not real
verification.** The project already runs without any anti-cheat beyond "the
server owns identity and past-day writes are refused" (0006, 0010's own
"identity is still not checked" precedent in `runs.ts`). A per-run cap is
cheap insurance against a malformed or hostile body minting an arbitrary
balance in one request; it is not a claim that the run is legitimate, the
same honesty 0010 already extends to every other number this handler trusts.

## Alternatives considered and ruled out

**A fifth independent seeded timeline**, placed and cleared the way oil and
moving barriers are. Rejected: a coin trail's whole purpose is to read as
"the line through the gate", which only means something if it is locked to
the gate's own open lane(s) — an independently seeded coin could land in a
lane the same row blocks, which looks like a bug, not a reward.

**Folding a coin's value into `car.distance`**, the same mechanism 0013 uses
for trick bonuses. Rejected once coins have their own schema column:
`users.coins` already exists and the shop already spends from it, so turning
a coin into more distance would need a conversion rate invented from nothing,
and would make the shop bill mean "sum of distance-equivalents" instead of
"coins picked up", which is a worse story to tell a player reading their own
balance.

**Crediting only on an improved run**, mirroring how `best_runs` only updates
on a new personal best. Rejected: a coin is picked up the moment the car
passes it, regardless of how the run ends — treating a non-improving run as
having picked up nothing would be the client quietly discarding real,
already-rendered pickups the player watched happen.

## Consequences

- `Obstacle`'s `kind` grows a fifth variant, `"coin"`, additive exactly the
  way `"ramp"` was under 0013 — nothing above `coinsThrough` in `track.ts`
  changes meaning.
- `CarState` gains `collectedCoinZ`, a `Set<number>` rather than a single
  slot like `lastRampZ`, because many coins can be resident and collectible
  in the same frame window, unlike a ramp's one-at-a-time trick trigger.
- `/api/run-end` gains an optional `coins` field and an unconditional credit
  to `users.coins`, independent of the existing `improved` branch — the first
  time this handler writes to `users` for a reason other than `best_runs`.
- No `migrations/` change: coins already have a column (0010), and a coin
  pickup is not a new kind of currency, just a second way to earn the
  existing one.
