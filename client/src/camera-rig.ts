// Speed and weight cues on top of car.ts's lane-offset model, entirely
// cosmetic — nothing here feeds back into the physics in car.ts. Three
// things, in roughly descending order of how much they actually sell "fast
// arcade driving" per plan.md's game-feel research: camera lag, FOV widening,
// and banking the car body into its own steering.
import * as THREE from "three";

const BASE_FOV = 70;
const MAX_FOV = 85;
const FOV_SPEED_REF = 40; // speed (m/s) at which FOV is fully widened
const FOV_SMOOTH = 4; // higher = snaps to target FOV faster

const CAMERA_LAG_SMOOTH = 6; // higher = tighter follow, lower = more trailing lag
const MAX_BANK_RADIANS = 0.32;
const BANK_SMOOTH = 8;

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

  /** Rolls `mesh` into `steer` (-1..1) — banking is most of what sells weight. */
  updateCarBank(mesh: THREE.Object3D, steer: number, dt: number): void {
    this.#bank = this.#ease(this.#bank, -steer * MAX_BANK_RADIANS, BANK_SMOOTH, dt);
    mesh.rotation.z = this.#bank;
  }
}
