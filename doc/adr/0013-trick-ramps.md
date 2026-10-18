# 0013. Trick ramps add a non-fatal obstacle kind, a client-only QTE, and a bought trick catalogue

Status: accepted

## Context

Reference concept art ("Nightly Build", the same orthographic obstacle sheet
0012 drew from) adds a fourth sheet: *Asset 03 — Trick Launch Ramp*. A
non-fatal launch ramp with synth-flame FX, chevron hazard striping, and
under-ramp hardware (booster thrusters) that sends the car airborne, paired
with a top-centre QTE prompt UI the player reacts to mid-air for a trick.

That sheet asks for three things `track.ts` and the rest of the stack don't
have yet: a fourth obstacle kind alongside 0012's `barrier` /
`moving-barrier` / `oil`, a quick-time-event mechanic, and a coin-bought
catalogue of tricks a player can be awarded. None of those land on an empty
slate — 0004 fixed the lane/pattern model, 0012 already solved "a non-fatal
obstacle needs its own invariant, not a slot in `patternIsSolvable`," 0002
fixed `(seed, distance)` purity as the thing the ghost/archive model depends
on, and 0010 already solved "a coin-bought catalogue with a free default."
The work here is fitting a fourth obstacle and a scoring mechanic into those
shapes without quietly contradicting any of them.

## Decision

**Extend `Obstacle`'s `kind` discriminant to `"barrier" | "moving-barrier" |
"oil" | "ramp"`** in `client/src/track.ts`. A ramp's placement — which
lane(s), at which distance — is a pure function of `(seed, distance)`, the
same seeded-distance/lane mechanism 0012 reused for oil rather than
inventing a parallel generator. Nothing about *where* a ramp sits depends on
who's asking or when.

Ramps are never fatal, so — exactly as 0012 argued for oil — they're excluded
from `patternIsSolvable`'s blocking check rather than given a slot in it, and
get their own narrower invariant instead: `RAMP_MIN_LEAD_TO_HAZARD`, proved
the same shape as oil's `OIL_MIN_LEAD_TO_HAZARD` by reusing
`firstFatalDistanceAtOrAfter` and an `oilDistanceFor`-style pullback search.
A ramp's QTE needs the camera to zoom and the player to have a real input
window mid-air; that only means something if the road ahead is guaranteed
clear for it, the same guarantee oil's forced drift already needs before the
next fatal hazard.

**Trick selection is per-attempt client state, chosen by `Math.random()` over
the player's owned tricks, and explicitly not part of the seed contract.**
Which QTE sequence a given ramp offers this time is not reproducible, is not
recorded, and is not something a second client replaying the same seed needs
to agree with. It never touches road geometry, collision, or the two numbers
the ghost actually records — lane and distance. A ramp is a seed-pure
obstacle at a seed-pure location; what happens on top of it, once the car is
already guaranteed to land clear, is a bonus-scoring overlay the recording
client invents for itself and nobody else needs to reconstruct.

**The trick's bonus folds straight into `car.distance`.** No new score
column, no `best_runs` schema change. Distance is already the score, the
leaderboard rank, and the coin-payout input per 0009/0010; a trick bonus is
just more distance, awarded by the same mechanism that already turns
"distance travelled" into every downstream number this game cares about.

**Tricks are bought, not equipped — a new `tricks` + `user_tricks` pair of
tables mirroring 0010's skins/coin-unlock pattern exactly**: the same
conditional-UPDATE-balance-deduction transaction shape, the same
`INSERT OR IGNORE` idempotence for the unlock row. A free default trick is
always available with no purchase, the same way magenta trim is a free
default skin under 0010 — every player can trigger *some* QTE on a ramp from
the first run, and coins buy a bigger catalogue of tricks on top of that, not
the ability to use ramps at all.

**Attract mode (`attract.ts`) is left unchanged.** Its `obstaclesAhead` /
`clearanceIn` / `chooseLane` lookahead applies no kind filter today, so the
autopilot will keep dodging ramps the same way it already dodges oil and
barriers — not because ramps need dodging, but because nothing tells it they
don't. That's a weaker outcome than "autopilot drives over ramps and ignores
them," and this record does not claim that outcome. Changing the shared
lookahead so it stops treating non-fatal kinds as something to route around
is a change that would affect oil and ramp together, and is out of scope
here.

## Alternatives considered and ruled out

**Seed the trick choice**, so two clients computing the same `(seed,
distance)` would agree on which QTE a given ramp offers. Rejected: no
contract in this codebase needs that determinism. Trick choice only ever
affects what the triggering player sees and their own bonus; it never affects
another player's experience of the same ramp, and it never reaches the
ghost, which records `(lane, distance)` and nothing about what the car was
doing in the air. Seeding it would spend complexity enforcing an agreement
nothing reads.

**A real airborne/invulnerability car state during the trick window**,
mirroring oil's forced-drift state in `CarState`. Deferred, not rejected
outright: `RAMP_MIN_LEAD_TO_HAZARD` already guarantees there's nothing ahead
to hit while the trick plays, so a second "can't crash right now" state
alongside oil's forced drift would add a state machine for a window that's
already safe by construction. Flagged for revisiting once the ramp is
actually playtested and it's clear whether the guarantee alone feels right.

**Fold ramps into `patternIsSolvable`.** Ruled out for exactly the reasoning
0012 already gave for oil: the check proves "a route exists," and a ramp
never removes one, so there's nothing for it to prove. A ramp gets its own
narrower invariant for the same reason oil did.

## Consequences

- 0004's and 0012's solvability guarantee is untouched. `patternIsSolvable`
  still governs only the kinds that can actually block a lane; ramps sit
  outside it exactly as oil does, under their own minimum-lead invariant.
- 0002's archive/ghost contract is preserved by construction: trick selection
  never touches `(lane, distance)`, so a ghost recorded during one run
  replays identically regardless of which trick the original player rolled.
- 0010's coin/unlock transaction shape is reused verbatim for a new
  catalogue — a new pair of tables, not a new pattern to review.
- No `best_runs` schema change; a trick's bonus is just more distance,
  already the one number every downstream system (rank, payout, ghost) reads.
- Attract mode's existing oil-dodging behaviour now also covers ramps,
  unchanged, by construction — no new code needed there, and no stronger
  "ignores ramps" behaviour claimed either.
