// Attract mode: the title screen's car drives the real track, by itself.
//
// This replaces the parked portrait the title screen used to show. It is not
// a canned animation or a second scene — it is the actual car, on the actual
// seeded road for the selected day, stepped by the same `stepCar` a real run
// uses, dodging the same obstacles `chunkFor` generates. The only things that
// differ from a race are who presses the buttons (see `chooseLane` below) and
// that nothing it does is ever recorded.
//
// Everything the game looks like comes along with that for free: the banded
// sun, the scrolling grid, the wireframe skyline, the speed lines, the
// post-processing and the archive aging are all just "the scene", and the
// title screen is now looking at it rather than at an empty backdrop.
import * as THREE from "three";
import { shiftLane } from "./car.ts";
import type { CarState } from "./car.ts";
import { chunkFor, CHUNK_LENGTH, laneX, LANES } from "./track.ts";
import type { Lane, Obstacle } from "./track.ts";

/**
 * How far ahead the autopilot looks, in metres.
 *
 * Gates arrive between 0.85s and 0.36s apart (track.ts's GATE_INTERVAL_*),
 * and at the 65 m/s ceiling the tightest of those is ~23m. Looking two of
 * those ahead means the car commits to a lane well before the gate rather
 * than swerving at the last metre, which is both safer and better-looking.
 */
const LOOKAHEAD_M = 55;

/**
 * Clearance at which a lane stops counting as "better".
 *
 * Without this the car chases whichever lane is marginally clearest and
 * weaves continuously down an empty road. Any lane with this much room is as
 * good as any other, so it holds its line instead.
 */
const COMFORTABLE_M = LOOKAHEAD_M;

/**
 * Metres of extra room demanded before swapping lanes.
 *
 * A pure "best lane wins" rule flip-flops when two lanes are nearly equal —
 * the car twitches between them every frame as the numbers cross. Staying put
 * unless the alternative is clearly better is what makes it look decided.
 */
const SWITCH_MARGIN = 6;

/**
 * Seconds the wreck stays on screen before the demo restarts.
 *
 * The autopilot is good but the track is generated, not designed, and a
 * pattern can demand a shift the car physically cannot make in time. Rather
 * than pretend that never happens, the demo crashes honestly — exactly as a
 * player would — and then quietly starts again.
 */
export const ATTRACT_RESPAWN_SECONDS = 1.6;

/**
 * Every obstacle within the lookahead window, gathered from the same chunk
 * generator the road is built from.
 *
 * Reads chunks directly rather than the built `THREE.Group`s: the autopilot
 * has to see gates slightly before they are streamed in, and `chunkFor` is a
 * pure function of (seed, index) so asking early costs nothing and agrees
 * with whatever is drawn later by construction (ADR 0002/0004).
 */
export function obstaclesAhead(seed: string, distance: number): Obstacle[] {
  const from = Math.floor(distance / CHUNK_LENGTH);
  const to = Math.floor((distance + LOOKAHEAD_M) / CHUNK_LENGTH);
  const found: Obstacle[] = [];
  for (let index = from; index <= to; index++) {
    for (const obstacle of chunkFor(seed, index).obstacles) {
      // Obstacles sit at negative z; the car's distance is positive.
      const ahead = -obstacle.z - distance;
      if (ahead >= 0 && ahead <= LOOKAHEAD_M) found.push(obstacle);
    }
  }
  return found;
}

/** Metres of clear road in `lane`, capped at the lookahead window. */
function clearanceIn(lane: Lane, obstacles: Obstacle[], distance: number): number {
  let nearest = LOOKAHEAD_M;
  for (const obstacle of obstacles) {
    if (obstacle.lane !== lane) continue;
    nearest = Math.min(nearest, -obstacle.z - distance);
  }
  return nearest;
}

/**
 * Which lane the demo should be heading for.
 *
 * Deliberately simple: most clearance wins, with a bias toward holding the
 * current line. It is a showcase, not a solver — and `shiftLane` only ever
 * moves one lane at a time anyway, so the car naturally walks toward a
 * distant target rather than teleporting to it.
 */
export function chooseLane(current: Lane, seed: string, distance: number): Lane {
  const obstacles = obstaclesAhead(seed, distance);
  const here = clearanceIn(current, obstacles, distance);
  // Already fine where it is — hold the line rather than drift for nothing.
  if (here >= COMFORTABLE_M) return current;

  let best = current;
  let bestClearance = here + SWITCH_MARGIN; // the incumbent's head start
  for (const lane of LANES) {
    if (lane === current) continue;
    const clearance = clearanceIn(lane, obstacles, distance);
    // Prefer the nearer lane on a tie: a one-step move happens sooner than a
    // two-step one, which matters when the gate is close.
    const closer = Math.abs(lane - current) < Math.abs(best - current);
    if (clearance > bestClearance || (clearance === bestClearance && closer)) {
      best = lane;
      bestClearance = clearance;
    }
  }
  return best;
}

/** Steers the demo car one step. Call once per frame while attract mode runs. */
export function driveAttract(car: CarState, seed: string): void {
  if (car.crashed) return;
  const want = chooseLane(car.lane, seed, car.distance);
  if (want === car.lane) return;
  shiftLane(car, want > car.lane ? 1 : -1);
}

// ---- camera ----

/**
 * Where the attract camera sits relative to the car, in metres.
 *
 * Lower and further back than the race's chase cam, and offset to the car's
 * left so the shot is a three-quarter rear rather than the dead-astern view
 * you drive from. That angle is what shows the car as an object — flank,
 * wing and tail-lights — while still looking down the road at the sun, which
 * is the whole reason to put a game's own scene behind its title.
 */
const CAMERA_OFFSET = new THREE.Vector3(-2.9, 1.75, 6.0);

/**
 * How far ahead of the car the camera looks. Far enough that the road and the
 * sun carry the frame rather than a bumper, close enough that the car is a
 * subject rather than a speck.
 */
const LOOK_AHEAD_M = 13;
/** Raised slightly so the horizon and sun sit in frame, not just tarmac. */
const LOOK_HEIGHT = 1.25;

/**
 * How far right the frustum is pushed, as a fraction of viewport width —
 * which slides everything rendered to the LEFT, clearing the right-hand half
 * for the menu.
 *
 * Applied with `setViewOffset` rather than by moving or aiming the camera:
 * both of those rotate the shot, and this has to keep the composed angle
 * above exactly as framed. Larger than the parked portrait's shift was,
 * because the menu it has to clear is now considerably wider.
 */
export const FRAME_SHIFT = 0.3;
/**
 * The portrait equivalent, as a fraction of viewport height.
 *
 * On a phone the menu is full-width and stacks under the car, so there is no
 * "left half" to clear — the shot shifts vertically instead. A POSITIVE
 * y-offset moves the sampled window down the frustum, which lifts the subject
 * toward the top of the screen, into the clear band above the menu's scrim.
 * (The sign is the opposite of what "lift" suggests; getting it backwards
 * puts the car under the buttons, which is exactly where it started.)
 */
const PORTRAIT_LIFT = 0.18;

/**
 * Where the attract camera wants to be, given the car it is following.
 *
 * `portrait` swings it round behind the car and lifts it: a phone's menu is
 * full-width and eats the bottom half of the screen, so the side-on framing
 * that works in landscape puts the car under the buttons. From higher and
 * more directly astern, the car and the road ahead of it both fit in the
 * clear strip above the menu.
 */
export function attractCameraTarget(
  car: CarState,
  out: THREE.Vector3,
  portrait = false,
): THREE.Vector3 {
  const offsetX = portrait ? CAMERA_OFFSET.x * 0.35 : CAMERA_OFFSET.x;
  const offsetY = portrait ? CAMERA_OFFSET.y + 1.5 : CAMERA_OFFSET.y;
  return out.set(car.offset + offsetX, offsetY, -car.distance + CAMERA_OFFSET.z);
}

/** What it looks at: down the road, not at the car. */
export function attractLookAt(car: CarState, out: THREE.Vector3): THREE.Vector3 {
  // Aimed at the centreline rather than the car's own lane, so a lane change
  // slides the car across the frame instead of dragging the whole world with
  // it — the camera holds its line and the car moves within the shot.
  return out.set(car.offset * 0.35, LOOK_HEIGHT, -car.distance - LOOK_AHEAD_M);
}

/**
 * Clears the right-hand half of the screen for the menu, without touching the
 * camera's position or aim.
 *
 * `setViewOffset` is sticky: left set, the entire race renders off-centre,
 * and `resize()` recomputing `camera.aspect` does not clear it. Hence
 * `clearAttractFraming` below, called on the way into a run.
 */
export function applyAttractFraming(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): void {
  if (width >= height) {
    camera.setViewOffset(width, height, width * FRAME_SHIFT, 0, width, height);
  } else {
    camera.setViewOffset(width, height, 0, height * PORTRAIT_LIFT, width, height);
  }
}

export function clearAttractFraming(camera: THREE.PerspectiveCamera): void {
  camera.clearViewOffset();
}

// ---- lighting ----

/**
 * Two spotlights at the car's headlights, throwing a real pool of light down
 * the road ahead of it.
 *
 * The headlight meshes are already emissive and already bloom, so this is not
 * what makes them visible — it is what makes them *light something*, which is
 * most of what sells the shot now that the car is moving over a road surface
 * the pool can actually fall on. Off during a race, where a chase camera
 * never sees the pool and the GPU budget is real.
 */
export function createHeadlights(): THREE.Group {
  const group = new THREE.Group();
  // Matches the headlight meshes in car-model.ts: x = ±0.33, y = -0.19
  // within a group sitting at y = 0.5, nose at z = -0.85.
  for (const x of [-0.33, 0.33]) {
    const light = new THREE.SpotLight(0xdff6ff, 16, 34, Math.PI / 7, 0.55, 1.4);
    light.position.set(x, 0.31, -0.85);
    // A SpotLight aims at its `target`, which must be in the scene graph for
    // its world matrix to update — a detail that otherwise silently leaves
    // the cone pointing at the world origin.
    light.target.position.set(x * 2.2, 0.05, -18);
    group.add(light, light.target);
  }
  return group;
}

export function setHeadlightsActive(group: THREE.Group, active: boolean): void {
  group.visible = active;
}

/**
 * A soft key light from the camera's side, so the bodywork reads as a solid
 * object rather than a hole with wireframes floating in it.
 *
 * Gentler than the parked portrait's version: the car is further away now and
 * the scene's own rim light is doing the job it was aimed for, so this only
 * has to lift the near flank out of silhouette. Follows the car, because a
 * fixed light the car drives away from stops lighting it within seconds.
 */
export function createAttractKeyLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xd8c4ff, 0.9);
  light.position.set(-5, 5, -8);
  return light;
}

/** Keeps the key light with the car. Call once per frame while attract runs. */
export function updateAttractKeyLight(light: THREE.DirectionalLight, car: CarState): void {
  const z = -car.distance;
  light.position.set(car.offset - 5, 5, z + 4);
  light.target.position.set(car.offset, 0.5, z);
  light.target.updateMatrixWorld();
}

/** Where a demo run starts from. Exported so main.ts can park the car there. */
export const ATTRACT_START = new THREE.Vector3(laneX(0), 0.5, 0);
