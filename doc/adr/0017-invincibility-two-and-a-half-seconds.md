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

## Consequences

- The window is 0.5s longer, so the car can pass through about 0.5s more road
  of barrier rows, about 9m at base speed.
- `spec/invincible.test.ts` uses `INVINCIBLE_SECONDS` symbolically, so it needs
  no change.
- 0016 is marked superseded by this record. Its body is otherwise untouched.
