import { centerXAtDistance, ROAD_HALF_WIDTH } from "./track.ts";
import type { Obstacle } from "./track.ts";

const BASE_SPEED = 9; // m/s
const SPEED_GROWTH = 0.9; // extra m/s per sqrt(metre travelled) — gentle ramp
const STEER_SPEED = 6; // lateral m/s at full input
const CAR_HALF_WIDTH = 0.6;
const OBSTACLE_HALF_WIDTH = 0.6;
const COLLISION_WINDOW = 1.2; // metres of forward slack for a hit test

export interface CarState {
  distance: number; // metres travelled — this run's score
  offset: number; // lateral offset from the track centerline
  crashed: boolean;
}

export function createCar(): CarState {
  return { distance: 0, offset: 0, crashed: false };
}

export function speedAt(distance: number): number {
  return BASE_SPEED + SPEED_GROWTH * Math.sqrt(distance);
}

export function worldX(seed: string, car: CarState): number {
  return centerXAtDistance(seed, car.distance) + car.offset;
}

// steer is -1..1 (left/right input). Returns true the frame the car crashes.
export function stepCar(
  seed: string,
  car: CarState,
  steer: number,
  dt: number,
  nearbyObstacles: Obstacle[],
): boolean {
  if (car.crashed) return false;

  const speed = speedAt(car.distance);
  car.distance += speed * dt;
  car.offset += steer * STEER_SPEED * dt;

  const maxOffset = ROAD_HALF_WIDTH - CAR_HALF_WIDTH;
  if (car.offset > maxOffset || car.offset < -maxOffset) {
    car.offset = Math.max(-maxOffset, Math.min(maxOffset, car.offset));
    car.crashed = true;
    return true;
  }

  const carX = worldX(seed, car);
  const carZ = -car.distance;
  for (const obstacle of nearbyObstacles) {
    if (Math.abs(obstacle.z - carZ) > COLLISION_WINDOW) continue;
    if (Math.abs(obstacle.x - carX) < CAR_HALF_WIDTH + OBSTACLE_HALF_WIDTH) {
      car.crashed = true;
      return true;
    }
  }

  return false;
}
