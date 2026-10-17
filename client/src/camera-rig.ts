// Speed and weight cues on top of car.ts's discrete lane model, entirely
// cosmetic — nothing here feeds back into the physics in car.ts. Three
// things, in roughly descending order of how much they actually sell "fast
// arcade driving" per plan.md's game-feel research: camera lag, FOV widening,
// and banking the car body into its own lane slide.
import * as THREE from "three";

const BASE_FOV = 70;
const MAX_FOV = 85;
const FOV_SPEED_REF = 40; // speed (m/s) at which FOV is fully widened
const FOV_SMOOTH = 4; // higher = snaps to target FOV faster

const CAMERA_LAG_SMOOTH = 6; // higher = tighter follow, lower = more trailing lag
const MAX_BANK_RADIANS = 0.32;
// Raised from 8 for ADR 0004's lane slides: a slide lasts 120ms, and a
// smoothing rate of 8 has a ~125ms time constant, so the bank was still
// winding up as the car arrived. 14 lands the roll inside the slide.
const BANK_SMOOTH = 14;

export class CameraRig {
  #smoothedPos = new THREE.Vector3();
  #fov = BASE_FOV;
  #bank = 0;
  #initialized = false;

  /** Exponential smoothing toward a target over dt — frame-rate independent. */
  #ease(current: number, target: number, rate: number, dt: number): number {
    const t = 1 - Math.exp(-rate * dt);
    return current + (target - current) * t;
  }

  /**
   * Forgets where the camera was, so the next updateCamera snaps into place
   * instead of easing there.
   *
   * Used when the two shots are genuinely different places rather than a move
   * between them — returning from a race to the attract demo, say. Starting a
   * race does the opposite and deliberately flies between them; see
   * `client/src/race-start.ts`.
   */
  reset(): void {
    this.#initialized = false;
    this.#bank = 0;
  }

  /**
   * Places the camera exactly, with no lag, and leaves the rig primed to
   * continue smoothly from there.
   *
   * The race-start transition drives the camera itself for its duration, and
   * then hands control back. Without seeding `#smoothedPos` the rig would
   * believe the camera was still wherever it was before the transition and
   * yank it back on the first frame after — undoing the whole move in a
   * single frame.
   */
  placeAt(camera: THREE.PerspectiveCamera, position: THREE.Vector3, lookAt: THREE.Vector3, fov: number): void {
    this.#smoothedPos.copy(position);
    this.#initialized = true;
    this.#fov = fov;
    camera.position.copy(position);
    camera.lookAt(lookAt);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** The FOV the chase camera wants at `speed` — what a transition eases toward. */
  static chaseFov(speed: number): number {
    return BASE_FOV + (MAX_FOV - BASE_FOV) * Math.min(1, speed / FOV_SPEED_REF);
  }

  /**
   * Moves `camera` toward (x, y, z), looking at (lookX, lookY, lookZ), with a
   * small trailing lag, and widens its FOV with speed. Returns nothing — the
   * camera is mutated directly, same as the rest of the render loop.
   */
  updateCamera(
    camera: THREE.PerspectiveCamera,
    dt: number,
    target: THREE.Vector3,
    lookAt: THREE.Vector3,
    speed: number,
  ): void {
    if (!this.#initialized) {
      this.#smoothedPos.copy(target);
      this.#initialized = true;
    } else {
      this.#smoothedPos.x = this.#ease(this.#smoothedPos.x, target.x, CAMERA_LAG_SMOOTH, dt);
      this.#smoothedPos.y = this.#ease(this.#smoothedPos.y, target.y, CAMERA_LAG_SMOOTH, dt);
      this.#smoothedPos.z = this.#ease(this.#smoothedPos.z, target.z, CAMERA_LAG_SMOOTH, dt);
    }
    camera.position.copy(this.#smoothedPos);
    camera.lookAt(lookAt);

    const targetFov = BASE_FOV + (MAX_FOV - BASE_FOV) * Math.min(1, speed / FOV_SPEED_REF);
    this.#fov = this.#ease(this.#fov, targetFov, FOV_SMOOTH, dt);
    if (Math.abs(camera.fov - this.#fov) > 0.01) {
      camera.fov = this.#fov;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Rolls `mesh` into its lane slide — banking is most of what sells weight.
   * `slide` is normalised lateral velocity (-1..1), so the roll peaks mid-slide
   * and unwinds as the car settles, rather than tracking a held key.
   */
  updateCarBank(mesh: THREE.Object3D, slide: number, dt: number): void {
    this.#bank = this.#ease(this.#bank, -slide * MAX_BANK_RADIANS, BANK_SMOOTH, dt);
    mesh.rotation.z = this.#bank;
  }
}
