# 0014. A ramp pairs with one barrier, and its QTE runs on a slowed, whole-sequence window

Status: accepted

## Context

0013 shipped the first version of the trick ramp: a ramp hugs "the next fatal
hazard" of any kind (a static-barrier row or a moving-barrier sweep) by
`RAMP_MIN_LEAD_TO_HAZARD`, and the QTE itself runs a 1.5-second timeout *per
step*, advancing a 2-glyph look-ahead prompt in real time while the camera
zooms in. Playtesting turned up four problems with that shape:

- A ramp never actually jumps anything in particular — it just guarantees
  clear road ahead of whichever hazard happens to come next, so "landing"
  isn't a real event, just a byproduct of never crashing.
- Running the whole world (and the per-step timer) at normal speed makes a
  multi-step sequence hard to read and react to in time.
- Only the current and next glyph are ever shown, so a 3- or 4-step sequence
  is never visible as a whole, and there is no visual sense of how much time
  is left.
- Nothing guarantees the car actually clears the hazard it jumped if the
  trick is failed or times out — it relies entirely on
  `RAMP_MIN_LEAD_TO_HAZARD` leaving enough road, which 0013 itself flagged as
  a guarantee worth revisiting ("Alternatives considered: a real
  airborne/invulnerable car state... deferred, not rejected... flagged for
  revisiting once the ramp is actually playtested").

This record supersedes those two specific decisions in 0013 — "hugs the
nearest fatal hazard of any kind" and "no real airborne/invulnerable state,
rely on lead distance alone" — while leaving the rest of 0013 intact (seed
purity, `Math.random()` trick selection, the bought-catalogue model, the
bonus folding into `car.distance`, attract mode unchanged).

## Decision

**A ramp pairs with one specific single-lane static-barrier row — the row it
jumps — rather than merely guaranteeing clear road before whatever fatal
hazard comes next.** `track.ts`'s `rampSpotFor` now searches forward for the
next *single-lane* barrier row (skipping past any 2-lane row or
moving-barrier sweep it finds first, since those aren't something a ramp can
cleanly stand in for), and places the ramp `RAMP_MIN_LEAD_TO_HAZARD` before
it, in that barrier's own lane. `Ramp`/`Obstacle` carry the paired
`barrierDistance` alongside `distance`/`lane`, so nothing downstream has to
re-derive the pairing.

**The car is exempt from colliding with its trick's paired barrier for the
whole QTE, settles unconditionally into that barrier's lane the instant the
trick settles (win or lose), and keeps travelling at its own pace — not
teleported — until it has actually gone far enough to clear the barrier.**
This is the "real invulnerability window" 0013 deferred: `CarState` gains
`exemptBarrierZ`, set by `main.ts` the frame a ramp is hit and cleared once
`car.distance` naturally passes `barrierDistance + LANDING_CLEARANCE` —
which, under slow-mo, is often well after the trick itself has settled, so
the exemption has to outlive the trick state rather than being tied to it.
Landing is now a guaranteed, visible event instead of an emergent property of
lead distance — a jump always clears what it jumped, exactly like the
concept art's premise — without ever snapping the car's distance forward,
which would read as teleporting rather than landing.

**The QTE runs on one whole-sequence timer, not a per-step one, with the
world slowed down for its duration.** `trick.ts`'s `TRICK_WINDOW_SECONDS = 2`
replaces the old per-step `STEP_TIMEOUT_SECONDS`; a wrong key or the window
running out both fail whichever step is still pending and end the sequence
immediately (doc/adr/0013's existing "a wrong input or a timeout both end the
sequence" carries over unchanged, just against one clock instead of many).
`main.ts` scales the `dt` fed into the car/camera/stream step by
`TRICK_SLOWMO_FACTOR` while a trick is active or its settled result is still
being held on screen — but always feeds `advanceTrick` the real, unscaled
`dt`, so the two-second budget stays a fixed wall-clock window regardless of
how slow the world looks. Slow-mo is a readability layer on top of a fixed
reaction budget, not a way to stretch it.

**Every step of the sequence (capped at `MAX_TRICK_STEPS = 4`, matching the
catalogue's longest entry) is shown at once, each independently tinted
pending/green/red as it resolves, alongside a bar draining over the
2-second window.** This replaces the old 2-glyph look-ahead text. Nothing in
the existing bought-catalogue data needs to change — every seeded trick is
already 4 steps or fewer.

## Alternatives considered and ruled out

**Pair with the nearest fatal hazard regardless of lane count**, exempting
the whole row (both lanes of a 2-lane row, or every instant of a moving
sweep) for the trick's duration. Rejected: a 2-lane row or a moving sweep
isn't a single "thing to jump" the way a single-lane row is, and exempting
either would mean the ramp sometimes grants the car a much larger
invulnerability window than the concept of "jumping one obstacle" implies.
Skipping ahead to the next single-lane row keeps the exemption narrow and the
jump legible as one specific hazard.

**Keep per-step timeouts, only add a visible timer bar per step.** Rejected:
the point of showing every step at once is to let the player plan the whole
sequence before acting, which only makes sense against one shared time
budget — a per-step clock would still force reacting to steps one at a time,
defeating the "see it all, play it as a combo" goal.

## Consequences

- 0013's seed-purity, catalogue, bonus-folding, and attract-mode decisions
  are untouched; `(seed, distance)` purity is preserved — a ramp's pairing is
  a pure function of the same seeded barrier playlist `track.ts` already
  generates, not new randomness.
- `RAMP_MIN_LEAD_TO_HAZARD` is no longer a safety-critical invariant (the
  exemption/landing-snap mechanism is what actually keeps a trick survivable
  now); it remains as the distance that makes the jump read as a jump rather
  than a precaution.
- `spec/track-ramp.test.ts` now asserts the pairing (lane match, nothing
  fatal between ramp and barrier) instead of only a minimum lead distance.
- `spec/trick.test.ts` is rewritten against the whole-sequence
  window/per-step-results model; the old per-step "ok" pulse outcome no
  longer exists.
- A ramp can only ever land immediately before a single-lane barrier row; a
  stretch of road with only 2-lane rows and moving sweeps pushes the next
  ramp further out than before, since `rampSpotFor` now skips past those
  looking for a pairable row. This is a wider, not narrower, minimum gap
  between ramps than 0013's version, so `RAMP_INTERVAL_METRES`'s own floor
  remains a backstop rather than the only thing keeping ramps apart.
