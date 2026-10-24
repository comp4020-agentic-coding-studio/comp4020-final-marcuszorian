# 0019. Attract mode prefers a ramp-free lane when one is free to take

Status: accepted

Supersedes doc/adr/0013's "Attract mode is left unchanged" clause only — and,
within it, specifically the claim that ramps don't need dodging and that
touching the shared lookahead is out of scope. Everything else 0013/0014/0018
decided (seed purity, the ramp/barrier pairing, the bought-catalogue model,
the equip mechanic, the bonus folding into `car.distance`) stands untouched.

## Context

0013 left `attract.ts` alone on the reasoning that nothing about a ramp needs
routing around — it's non-fatal, so the autopilot driving straight over one
was judged a non-issue, just a side effect of `clearanceIn` not filtering by
kind at all. 0012's `NON_FATAL_KINDS` set later made that explicit: ramps are
excluded from hazard-clearance scoring on purpose, the same as oil, so they
never distort the car's dodging of real hazards.

The demo car doing a trick, or clipping through ramp geometry mid-flight, now
reads as a visible seam in a showcase meant to look like confident, decided
driving — the car should look like it's choosing its line, not stumbling into
scenery the game itself doesn't expect it to react to (`main.ts`'s attract
branch never reads `result.rampHit`, so a ramp hit there triggers nothing).
The fix isn't "ramps are secretly hazards now" — they still aren't — it's that
the demo should visibly steer clear of them when nothing forces it to do
otherwise.

## Decision

**Ramps stay in `NON_FATAL_KINDS` and out of `clearanceIn`'s hazard-clearance
score.** Barrier and moving-barrier avoidance in `chooseLane` is completely
untouched and keeps full priority — this record adds a preference on top, not
a new hazard underneath.

**A new, strictly lower-priority check only runs once the current lane
already reads as fully hazard-clear (`here >= COMFORTABLE_M`) — the exact
branch where `chooseLane` used to just `return current`.** Folding a ramp
penalty directly into `clearanceIn`'s score was rejected: `SWITCH_MARGIN`'s 6m
hysteresis exists precisely to stop the car twitching between near-equal
lanes, so a ramp penalty small enough to never outrank a real hazard would
almost always be swallowed by that margin and never fire at all. Gating the
check behind "hazard-avoidance already has nothing to say" sidesteps that
tension entirely instead of trying to tune around it.

**Inside that branch, if the current lane has a ramp (`hasRampIn`), the car
looks for the nearest lane (fewest lane-changes) that is both ramp-free and
still at full `COMFORTABLE_M` clearance, and takes it if one exists.** "Nearest"
reuses the same fewest-lane-changes preference `chooseLane`'s hazard branch
already applies on a tie. A candidate lane two steps away is checked against
the same mid-slide crossing hazard test (`CROSSING_DANGER_M`) the hazard
branch uses for a two-lane move, so a ramp dodge can never slide the car
through a hazard sitting in the lane it crosses to get there.

**If no such lane exists — every lane has a ramp, or the only ramp-free lane
isn't safely reachable — the car holds its line and drives over the ramp.**
This is the literal reading of "avoid unless absolutely necessary": a ramp is
never worth crashing, or risking a crash, to dodge. The new preference can
only ever choose among lanes the hazard check has already certified as fully
clear; it never has the authority to accept a riskier lane just to avoid a
ramp.

Net effect: on open road, the demo now visibly favours ramp-free lanes. When
the road is actually tight and lane choice is being driven by real hazards,
ramp presence is invisible to the decision, exactly as it was before this
record — the car still drives over a ramp whenever that's what the hazard
check calls for.

## Alternatives considered and ruled out

**Fold a ramp penalty into `clearanceIn`'s normal hazard score.** Rejected:
as above, any penalty small enough to respect `SWITCH_MARGIN` and never
outrank a real hazard gets absorbed by that same margin and stops affecting
lane choice at all; tuning it larger risks it competing with genuine
hazard-dodging, which 0012 specifically built `NON_FATAL_KINDS` to prevent.

**Give ramp avoidance priority over hazard avoidance**, so the car would
route around a ramp even at the cost of a riskier lane. Rejected outright —
it directly contradicts "unless absolutely necessary," and a demo that
crashes (or nearly does) to dodge a non-fatal obstacle would look worse, not
better, than one that calmly drives over it.

**Leave attract mode fully unchanged**, per 0013's original call. Superseded
here: the original reasoning ("ramps don't need dodging") is still true as
far as safety goes, but it answered a different question than the one this
record asks — whether the demo should look like it's choosing to avoid a ramp
when it costlessly can, as part of presenting a polished, decided driving
line rather than a pattern of visible non-reactions to track hazards.

## Consequences

- The demo now preferentially avoids ramps whenever the road is already
  clear, and otherwise behaves exactly as 0012/0013 left it.
- `main.ts`'s comment near its attract branch ("the autopilot dodges ramps
  the same way it already dodges oil (attract.ts applies no kind filter)")
  was already slightly stale before this record — `clearanceIn` has applied a
  kind filter since 0012's `NON_FATAL_KINDS`, it just didn't route around
  ramps at all. It is now more stale still, since the autopilot can actively
  route around a ramp under this record. Worth a follow-up touch-up; not
  fixed here, since this record changes behaviour in `attract.ts`, not the
  stale comment's accuracy in `main.ts`.
- No change to `(seed, distance)` purity, ramp/barrier pairing, the trick
  catalogue, or any other ADR's invariant — this is new logic inside
  `attract.ts`'s `chooseLane`, downstream of track generation, not a change
  to it.
- `spec/attract-ramp.test.ts` is added to assert the new preference: a
  ramp-free alternative lane is taken when available and safe, and the car
  holds its lane and drives over a ramp when every alternative is unsafe or
  also has a ramp.
