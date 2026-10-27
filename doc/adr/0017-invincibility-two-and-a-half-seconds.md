# 0017. A completed trick grants two and a half seconds of invincibility

Status: accepted

Supersedes the window length in 0016. Everything else in 0016 (what triggers
the window, what it lets through, the feedback, and the time base) stands.

## Context

Playtesting wanted a slightly longer protected window after a successful
trick, so the car has more time to read the road it lands in before barriers
can crash it again. 0016 fixed the window at two seconds.

## Decision

**A successful trick (`outcome === "done"`) makes the car invincible to
barriers for `INVINCIBLE_SECONDS` (2.5s), measured in real time.** Failed and
timed-out tricks grant nothing.

- `INVINCIBLE_SECONDS` in `car.ts` is the only place the duration is set.
  The HUD bar and flicker in `main.ts` read it, so they follow the new value.
- The rest of 0016 applies unchanged: real `dt`, pausing stops the window, and
  coins, oil and ramps behave as before.

## Alternatives considered

**Keep it at 2s and address the complaint some other way** (e.g. slow the
outcome hold, or start the window earlier in the trick animation). Rejected:
playtesting's complaint was specifically that 2s doesn't give enough road to
read before barriers resume, and 0016's own numbers show why a smaller fix
doesn't reach it — part of the two seconds is already spent in the 0.8s
slow-mo outcome hold, so trimming elsewhere only redistributes a window
that's too short to begin with. The window itself needed to grow.

**Go further (3.0s or more).** Rejected: 0016 already flags that an open
window makes a run's survival stop depending on lane choice while it's up;
every extra half-second compounds that, and pushed far enough it starts
reading as "trick well, then drive blind through a stretch of barriers,"
which undercuts 0012/0013's rule that barriers are what end a run. 2.5s is
the length playtesting asked for, not a step toward turning invincibility
into the dominant strategy.

**Take up 0016's open "distance window rather than a time window" option.**
Not taken: that tradeoff hasn't changed shape, it's just been asked to move
by half a second in the direction 0016 already named. The HUD bar reads as
time, the player asked for seconds, and reworking the invincibility model to
answer a 0.5s tuning request is disproportionate. Still open if a future
request needs the behaviour a distance window gives, not this one.

## Consequences

- The window is 0.5s longer, so the car can pass through about 0.5s more road
  of barrier rows, about 9m at base speed.
- `spec/invincible.test.ts` uses `INVINCIBLE_SECONDS` symbolically, so it needs
  no change.
- 0016 is marked superseded by this record. Its body is otherwise untouched.
