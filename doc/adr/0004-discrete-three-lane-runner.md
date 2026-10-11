# 0004. Three discrete lanes, not continuous steering

Status: accepted

## Context

Through C8 the game steered continuously: `car.offset` was a float, moved at
`STEER_SPEED` 6 m/s by held arrow keys, on a road whose centerline drifted
sideways by a seeded amount per 20m chunk (`CURVE_MAX` 1.4). Obstacles were
placed at a continuous `x` anywhere inside the road, 0 or 1 per chunk.

Three things about that model get worse, not better, as the speed ramp does
its job:

1. **Two tasks compete for the same input.** The drifting centerline means
   the player is always correcting just to stay on the road, and that
   correction uses the same two keys as dodging. At 400m `speedAt` is already
   27 m/s, and holding a lane against drift crowds out reading the obstacle
   ahead.
2. **Difficulty is incoherent.** An obstacle at a random continuous `x` is
   sometimes at the road edge (ignorable) and sometimes dead centre
   (demanding). Nothing in the generator distinguishes those, so the
   difficulty curve is noise rather than design.
3. **Nothing is solvable by construction.** With continuous placement there
   is no statement of the form "a way through always exists" that the
   generator could assert. It happens to hold today only because there is at
   most one obstacle per chunk.

## Decision

**Three discrete lanes at x = -2.4, 0, +2.4, a straight centerline, and
single-tap input that shifts exactly one lane per press.** Obstacles are
lane-filling barriers placed in rows; a row blocks one or two lanes, never
three.

The track becomes a seeded sequence drawn from a fixed catalogue of 20 hand-
written gate patterns (slaloms, clamps, squeezes, weaves) rather than
per-chunk random placement, with two empty rows between patterns.

**Solvability is asserted, not hoped for.** `patternIsSolvable` walks a
pattern row by row, propagating the set of lanes still reachable under "at
most one lane shift between consecutive rows", and a pattern whose reachable
set ever empties is a bug. Two patterns in the first draft of the catalogue
(a pair of staircases that forced a two-lane move between adjacent rows)
failed exactly this check and were replaced.

## Alternatives considered and ruled out

**Keep continuous steering, tune the constants** — drop `CURVE_MAX`, snap
obstacle `x` to a grid. This addresses (2) and part of (1) but not (3), and
leaves the fundamental problem that input precision requirements grow with
speed while the reaction window shrinks. The arcade runners this game is now
reaching for (*Subway Surfers*, *Audiosurf*) all discretised for this reason.

**Five lanes instead of three.** More expressive patterns, but each lane is
narrower on screen at the same road width, and crossing from edge to edge
costs four taps — long enough that a forced traversal stops being a reaction
and starts being a memorisation. Three keeps any lane one or two taps from
any other.

## Consequences

- **This is the new ADR that `0003-visual-direction.md` said to write.** That
  record's consequences froze track geometry and stated: "A future change
  that *does* need to touch the centerline is a new ADR, not an edit to this
  one or to 0002." This is that record. It revises exactly that one
  consequence of 0003; the visual direction itself — synthwave register,
  lavender ghosts, archive aging, zero new dependencies — is untouched and
  still in force.
- **`0002-daily-seeded-archive.md` is untouched and not superseded.**
  `best_runs` is still keyed by `(user_id, track_seed)`, `lane` is still a
  nullable `REAL`, and every day is still replayable. Nothing here is a
  schema change.
- **Old ghosts are snapped, not migrated.** Runs recorded before this change
  hold a continuous lateral offset in metres. `snapToLane` rounds that to the
  nearest of -1/0/+1 at render time, so a legacy ghost sits in a lane instead
  of between two. The cost is honest and worth naming: a ghost recorded at
  offset 1.8 is drawn at 2.4, so its *lateral* position is now
  approximate — up to 1.2m of lateral drift from where that player actually
  crashed. Its **distance**, which is the score and the thing the ghost is
  actually about, is untouched. No migration runs against production data.
- **`(seed, distance) → obstacles` stays a pure function**, which is what
  ADR 0002 needs in order for a ghost to sit on the road you are driving.
  Gate spacing now widens with speed, and since speed is a function of
  distance alone, spacing stays a function of distance alone. The row
  positions are built by a cumulative scan cached per seed — the same shape
  as the old `centerXAt` cache it replaces.
- **The reaction window is now a designed quantity.** Gate spacing is
  `speed × interval`, with the interval falling from 0.85s toward a 0.36s
  floor as the run goes on. The ramp can keep raising speed without the game
  becoming physically impossible, which the old fixed per-chunk placement
  could not promise.
- **The drift-following road strip is gone**, and with it the reason
  `roadMaterial` was `DoubleSide` (winding order varied with drift sign).
  Lane dividers are painted by the same `onBeforeCompile` overlay that drew
  the old centre dashes, so this remains materials-level work in the sense
  0003 meant.
