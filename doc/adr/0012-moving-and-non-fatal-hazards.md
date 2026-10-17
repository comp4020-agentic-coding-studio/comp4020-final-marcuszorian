# 0012. Moving barriers and non-fatal hazards extend, not revise, 0004

Status: accepted

## Context

Reference concept art ("Nightly Build", an orthographic obstacle sheet) asks
for two new obstacle kinds beyond the single static barrier `track.ts`
generates today:

1. *Obstacle 01 — Kinetic Hazard Barrier*: a barricade on slider rails that
   sweeps laterally across lanes. Fatal on contact, like the existing
   barrier — only the dodge changes, not the consequence of missing it.
2. *Obstacle 02 — Cyber-Slick*: a flat oil-spill splatter. Driving over it
   doesn't crash the car; it forces a brief, uncommanded lateral drift that
   can itself cause a crash afterward if it carries the car into a barrier or
   past the edge of the next reaction window.

Both have to fit inside what ADR 0004 already locked down: three discrete
lanes, single-tap shifts, a hand-written `Pattern` catalogue whose
solvability is asserted by `patternIsSolvable`, and — critically, per ADR
0002 — `(seed, distance)` as a pure function the whole ghost/archive model
depends on. A ghost only ever replays a recorded `(lane, distance)`; it never
re-runs collision. So whatever generates a moving barrier's position has to
be something both the recording client and a later viewing client compute
identically from `(seed, distance)` alone, with no wall-clock time or
per-session random state involved.

Oil raises a second, different question: `patternIsSolvable` proves "a lane
is always free," which is a statement about *fatal* hazards. Oil is never
fatal by itself, so folding it into that same check would either be
meaningless (it can't make a pattern unsolvable) or would need its own
parallel invariant (it can't leave a forced drift nowhere to resolve before
the next real hazard).

## Decision

**Extend `Obstacle` with a `kind: "barrier" | "moving-barrier" | "oil"`
discriminant**, rather than inventing a separate model or generator path for
the new kinds. Existing static barriers become `kind: "barrier"` with no
behavioural change — `patternIsSolvable` keeps governing them exactly as
before.

**A moving barrier's lane position is a deterministic function of the car's
own `distance`, not of wall-clock time.** Each moving-barrier obstacle
carries motion parameters (anchor distance, amplitude, wavelength, phase)
instead of a fixed `x`; `x` is computed at read time as
`laneX(center) + amplitude * sin(2π · (distance − anchor) / wavelength)`.
Two clients on the same seed, evaluating the same obstacle at the same
distance, get the same `x` — the archive/ghost contract in ADR 0002 is
unaffected because nothing about it depends on *when* a client reaches a
given distance, only on what distance it reports.

Moving-barrier groups (solo, phase-offset pairs, multi-row sequences) reuse
the existing `Pattern`/`Row` catalogue mechanism, with their own solvability
check: sample the occupied-lane set at many phase points across the
pattern's active window and assert at least one lane is always free at every
sample — the continuous analogue of `patternIsSolvable`'s row-by-row walk.

**Oil spills are placed the same seeded way as static barriers, but excluded
from `patternIsSolvable`'s blocking check**, since passing through one is
always survivable by itself. A new, separate invariant takes its place: oil
may not sit closer than a minimum follow-on distance to the next fatal
hazard, so a forced drift always has room to resolve before the next thing
that can actually end the run.

## Alternatives considered and ruled out

**Drive moving-barrier motion from wall-clock time** (e.g. `performance.now()`
or a frame counter) instead of `distance`. Simpler to write — no need to
invert "where is this obstacle right now" into a distance-based phase — but
it breaks the one property ADR 0002 and ADR 0004 both depend on: a client
reconstructing a past run (a ghost, or a reloaded page at a different
distance-to-wall-clock ratio) would see the barrier at a different phase than
the client that originally recorded it. Rejected outright; this is the one
piece of this plan that most needs the position stated plainly, since a
careless choice here would quietly and silently break the archive contract
that every other feature in this game relies on.

**Fold oil into `patternIsSolvable` as a third kind of "blocked" lane.**
Would require the solvability walk to distinguish "blocked" (must route
around) from "survivable but risky" (may route through), doubling the
state the check carries for no benefit — oil never removes a route, so it
has nothing to prove to that check. A separate, narrower invariant (minimum
spacing before the next fatal hazard) says exactly what needs saying and
nothing more.

**Give oil its own placement system, independent of the `Row`/distance
catalogue.** Rejected as unnecessary duplication — oil's placement needs are
a strict subset of what the existing seeded-distance/lane mechanism already
does (pick a distance, pick 1–2 lanes), so reusing it instead of inventing a
parallel one keeps the generator a single pure function to reason about.

## Consequences

- **ADR 0004's static-barrier model and solvability proof are untouched.**
  `patternIsSolvable` keeps exactly its current meaning for `kind: "barrier"`
  rows; this adds two new kinds alongside it rather than revising what that
  check proves or how it proves it. This record extends 0004; it does not
  supersede it.
- **ADR 0002's archive contract is preserved by construction, not by
  convention.** Because a moving barrier's `x` is a pure function of
  `(seed, distance)` — distance supplied by whichever client is asking, not
  by a clock — a ghost recorded during one run and replayed during another
  lands on the same lane at the same distance, including for a moving
  barrier, with no special-casing needed in ghost playback.
- **Two solvability checks now exist side by side**: the discrete,
  row-by-row `patternIsSolvable` for static and moving-barrier rows (sampled
  across phase for the latter), and a narrower minimum-spacing invariant for
  oil. They prove different things on purpose — "a route exists" versus "a
  forced drift has room to resolve" — and neither subsumes the other.
- **No server, route, or data-model change.** This is a generator and
  client-physics extension only, the same *kind* of change ADR 0004 itself
  was. `best_runs`, ghosts, and the `(user_id, track_seed)` schema from ADR
  0002 are untouched.
- **Oil introduces the game's first non-fatal obstacle category.** Every
  obstacle before this was binary — dodge it or crash — so this is also the
  first place "contact" and "crash" are different events, which is why the
  forced-drift state lives in `CarState` as a distinct mechanism from
  `car.crashed`, not a variant of it.
