# 0016. A completed trick grants two seconds of invincibility

Status: accepted

## Context

0013 deferred "a real airborne/invulnerable car state" and 0014 added a
narrow exemption for the one barrier a trick jumps. Neither covers what
happens once a trick *succeeds*: the bonus folds straight into `car.distance`
(0013), so the car, camera and world jump forward by 150-400m in one frame.
The player lands in a stretch of road they never saw coming, with no time to
read it, and the jump itself reads as a teleport.

## Decision

**A successful trick (`outcome === "done"`) makes the car invincible to
barriers for `INVINCIBLE_SECONDS` (2s), measured in real time.** Failed and
timed-out tricks grant nothing.

- `car.ts` owns the state (`CarState.invincibleT`, seconds remaining) and the
  rule: while it is above zero, `stepCar`'s collision loop skips static and
  moving barriers. Coins, oil and ramps behave exactly as before — invincible
  means "barriers pass through you", not "the world stops interacting".
- `main.ts` starts it on the frame the bonus is applied and drains it with the
  real, unscaled `dt` (the same clock `advanceTrick` uses), so it is two
  wall-clock seconds regardless of slow-mo. Pausing stops it, because the
  frame loop does not step while paused.
- Feedback is two things: the player car flashes translucent (reusing
  `setPlayerGhostly`, the same look as every ghost car), and a bar in the HUD
  drains over the window, styled after the trick's own timer bar. Under
  `prefers-reduced-motion` the car holds the translucent look steadily
  instead of flashing.

## Alternatives considered

**Clear obstacles ahead of the car.** Rejected: the track is a pure function
of `(seed, distance)` (0002, 0004) and ghosts and the archive depend on that.
Removing obstacles client-side would make one run's road differ from another's.
Invincibility leaves the road untouched.

**Smooth the bonus into `car.distance` over time.** Not rejected, just not
this change: it addresses the snap itself rather than what the player lands
into, and can be added on top of this.

**A distance window rather than a time window.** A time window lets a fast car
cover more road while protected (about 18m at base speed, 60m or more at
speed). Chosen anyway because the player asked for seconds and the bar reads
as time; a distance window is a small change if playtesting says otherwise.

## Consequences

- 0013's seed-purity and bonus-folding decisions are untouched; a ghost's
  recorded `(lane, distance)` is unaffected, and nothing is sent to the server.
- Invincibility starts when the trick settles, and the 0.8s outcome hold that
  follows runs in slow-mo, so some of the two seconds is spent covering little
  ground. The window is real time, not world time.
- A player can now drive through a barrier row without crashing, so a run's
  survival is no longer a pure function of lane choices alone while the window
  is open. The leaderboard still ranks by `car.distance`, which is unchanged.
- `spec/invincible.test.ts` pins the rule in `stepCar`.
