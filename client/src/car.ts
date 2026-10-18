import { LANE_HALF_WIDTH, LANE_WIDTH, hashString, laneX, movingBarrierX, mulberry32, snapToLane, speedAt } from "./track.ts";
import type { Lane, MotionParams, Obstacle } from "./track.ts";

export { speedAt };

/** Seconds for a lane change. ADR 0004: fast enough to feel like a tap. */
export const SLIDE_SECONDS = 0.12;
// Oil's forced drift reuses the same ease curve but runs far slower than a
// tap — it's meant to read as "the car is sliding, you're not in control
// yet", not as a second instantaneous lane change (doc/adr/0012).
export const OIL_SLIDE_SECONDS = 0.5;
const CAR_HALF_WIDTH = 0.6;
// Barriers fill their lane, so the hitbox half-width IS the lane half-width —
// what you see is what you hit.
const OBSTACLE_HALF_WIDTH = LANE_HALF_WIDTH;
const COLLISION_WINDOW = 1.2; // metres of forward slack for a hit test

/** Peak lateral speed of a slide — the reference the camera banks against. */
export const SLIDE_PEAK_SPEED = (1.5 * laneX(1)) / SLIDE_SECONDS;

export interface CarState {
  distance: number; // metres travelled — this run's score
  lane: Lane; // the lane the car is in, or sliding toward
  offset: number; // current lateral position in metres (interpolated)
  crashed: boolean;
  /** Where the current slide started, in metres. */
  slideFrom: number;
  /** Seconds elapsed in the current slide. */
  slideT: number;
  /** Where the current forced drift started, in metres. */
  driftFrom: number;
  /** Lateral position the forced drift is easing toward, in metres. */
  driftTarget: number;
  /** Seconds elapsed in the current forced drift; >= OIL_SLIDE_SECONDS means
   * no drift is active — the same "already settled" convention `slideT`
   * uses against `SLIDE_SECONDS`. */
  driftT: number;
}

export function createCar(): CarState {
  return {
    distance: 0,
    lane: 0,
    offset: 0,
    crashed: false,
    slideFrom: 0,
    slideT: SLIDE_SECONDS,
    driftFrom: 0,
    driftTarget: 0,
    driftT: OIL_SLIDE_SECONDS,
  };
}

/** True while oil's forced drift is overriding player input (doc/adr/0012). */
export function isDrifting(car: CarState): boolean {
  return car.driftT < OIL_SLIDE_SECONDS;
}

/** Cosmetic-only yaw for the forced drift: one full 360 across the drift's
 * window, landing back at 0 exactly as it settles, spinning the way the
 * drift is pushing the car. Linear rather than eased like the lateral
 * offset — a spin-out reads as a loss of control, so it shouldn't ease in
 * and out the way a deliberate slide does. */
export function driftSpinAngle(car: CarState): number {
  if (!isDrifting(car)) return 0;
  const direction = Math.sign(car.driftTarget - car.driftFrom) || 1;
  return -direction * (car.driftT / OIL_SLIDE_SECONDS) * Math.PI * 2;
}

/**
 * Shifts one lane in `dir` (-1 left, +1 right). A press while already sliding
 * retargets from wherever the car currently is, so taps stay responsive
 * instead of queueing up behind an animation.
 */
export function shiftLane(car: CarState, dir: -1 | 1): void {
  if (car.crashed) return;
  // A forced drift wins over player input for its whole window — the same
  // guard shape as the crashed check above (doc/adr/0012).
  if (isDrifting(car)) return;
  const next = car.lane + dir;
  if (next < -1 || next > 1) return;
  car.slideFrom = car.offset;
  car.slideT = 0;
  car.lane = next as Lane;
}

/**
 * Starts oil's forced drift toward the adjacent lane. Direction is pushed
 * away from an outer lane (there's nowhere further out to go) and otherwise
 * picked by a hash of the contact point, so the same spill always drifts the
 * same way without needing wall-clock or session random state.
 */
function startForcedDrift(car: CarState, obstacle: Obstacle): void {
  const direction: -1 | 1 =
    car.lane === 1 ? -1 : car.lane === -1 ? 1 : mulberry32(hashString(`oil-drift:${obstacle.z}:${obstacle.x}`))() < 0.5 ? -1 : 1;
  car.driftFrom = car.offset;
  car.driftTarget = car.offset + direction * LANE_WIDTH;
  car.driftT = 0;
}

/** Smoothstep — ease in and out of the slide rather than starting at full speed. */
function ease(p: number): number {
  return p * p * (3 - 2 * p);
}

/** Lateral velocity in m/s, signed. Cosmetic only — camera-rig.ts banks on it. */
export function lateralVelocity(car: CarState, previousOffset: number, dt: number): number {
  return dt > 0 ? (car.offset - previousOffset) / dt : 0;
}

/** Live `x` of an obstacle at the car's current distance — a moving barrier's
 * recorded `x` is only ever correct at its own anchor, so collision (and
 * rendering, in main.ts) always recomputes it from `motion` (doc/adr/0012). */
function obstacleXAt(obstacle: Obstacle, distance: number): number {
  return obstacle.kind === "moving-barrier" && obstacle.motion
    ? movingBarrierX(obstacle.lane, obstacle.motion as MotionParams, distance)
    : obstacle.x;
}

/** Returns true the frame the car crashes. */
export function stepCar(car: CarState, dt: number, nearbyObstacles: Obstacle[]): boolean {
  if (car.crashed) return false;

  car.distance += speedAt(car.distance) * dt;

  // A forced drift overrides the normal slide machinery for its whole
  // window, same priority order `shiftLane`'s guard gives it (doc/adr/0012).
  if (isDrifting(car)) {
    car.driftT = Math.min(OIL_SLIDE_SECONDS, car.driftT + dt);
    car.offset = car.driftFrom + (car.driftTarget - car.driftFrom) * ease(car.driftT / OIL_SLIDE_SECONDS);
    if (!isDrifting(car)) {
      // Settled: adopt the lane the drift actually landed in, and leave the
      // ordinary slide machinery with nothing left to animate.
      car.lane = snapToLane(car.offset);
      car.slideFrom = car.offset;
      car.slideT = SLIDE_SECONDS;
    }
  } else if (car.slideT < SLIDE_SECONDS) {
    car.slideT = Math.min(SLIDE_SECONDS, car.slideT + dt);
    const target = laneX(car.lane);
    car.offset = car.slideFrom + (target - car.slideFrom) * ease(car.slideT / SLIDE_SECONDS);
  } else {
    car.offset = laneX(car.lane);
  }

  // Tested against the interpolated offset, not the target lane: clipping a
  // barrier part-way through a slide is a crash (ADR 0004).
  const carZ = -car.distance;
  for (const obstacle of nearbyObstacles) {
    if (Math.abs(obstacle.z - carZ) > COLLISION_WINDOW) continue;
    const x = obstacleXAt(obstacle, car.distance);
    if (Math.abs(x - car.offset) >= CAR_HALF_WIDTH + OBSTACLE_HALF_WIDTH) continue;

    if (obstacle.kind === "oil") {
      // Contact starts a drift, not a crash — a crash afterward, if any, is
      // whatever the drift carries the car into on a later frame.
      if (!isDrifting(car)) startForcedDrift(car, obstacle);
      continue;
    }

    car.crashed = true;
    return true;
  }

  return false;
}
