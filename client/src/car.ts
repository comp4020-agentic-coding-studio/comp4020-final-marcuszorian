import { LANE_HALF_WIDTH, laneX, speedAt } from "./track.ts";
import type { Lane, Obstacle } from "./track.ts";

export { speedAt };

/** Seconds for a lane change. ADR 0004: fast enough to feel like a tap. */
export const SLIDE_SECONDS = 0.12;
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
}

export function createCar(): CarState {
  return { distance: 0, lane: 0, offset: 0, crashed: false, slideFrom: 0, slideT: SLIDE_SECONDS };
}

/**
 * Shifts one lane in `dir` (-1 left, +1 right). A press while already sliding
 * retargets from wherever the car currently is, so taps stay responsive
 * instead of queueing up behind an animation.
 */
export function shiftLane(car: CarState, dir: -1 | 1): void {
  if (car.crashed) return;
  const next = car.lane + dir;
  if (next < -1 || next > 1) return;
  car.slideFrom = car.offset;
  car.slideT = 0;
  car.lane = next as Lane;
}

/** Smoothstep — ease in and out of the slide rather than starting at full speed. */
function ease(p: number): number {
  return p * p * (3 - 2 * p);
}

/** Lateral velocity in m/s, signed. Cosmetic only — camera-rig.ts banks on it. */
export function lateralVelocity(car: CarState, previousOffset: number, dt: number): number {
  return dt > 0 ? (car.offset - previousOffset) / dt : 0;
}

/** Returns true the frame the car crashes. */
export function stepCar(car: CarState, dt: number, nearbyObstacles: Obstacle[]): boolean {
  if (car.crashed) return false;

  car.distance += speedAt(car.distance) * dt;

  if (car.slideT < SLIDE_SECONDS) {
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
    if (Math.abs(obstacle.x - car.offset) < CAR_HALF_WIDTH + OBSTACLE_HALF_WIDTH) {
      car.crashed = true;
      return true;
    }
  }

  return false;
}
