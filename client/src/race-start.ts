// The swing from the title screen's attract camera into the chase camera.
//
// Pressing Start used to be a hard cut: the demo's three-quarter rear shot
// was replaced by the chase shot on the next frame, and the frustum offset
// that holds the demo clear of the menu snapped back to centre at the same
// instant. Both are correct destinations; arriving at them instantly is what
// made it read as a scene change rather than as getting into the car.
//
// This drives the camera for a beat instead — position, aim, field of view
// and the frustum offset all eased together, so the shot swings around behind
// the car, settles into the chase view, and hands back to CameraRig already
// in the right place.
import * as THREE from "three";

/**
 * How long the swing takes.
 *
 * Long enough to read as a move rather than a stutter; short enough that it
 * never feels like a cutscene standing between the button and the game. The
 * car is already driving throughout — this is a camera move over a live run,
 * not a pause before one.
 */
export const RACE_START_SECONDS = 0.85;

/**
 * Ease-out cubic. Fast off the mark and settling gently into the chase
 * position, which is the shape that reads as the camera *arriving* rather
 * than drifting — the opposite end matters more than the start here, because
 * the player is already watching the road by then.
 */
function ease(t: number): number {
  const p = 1 - t;
  return 1 - p * p * p;
}

/** A camera pose: where it is, what it looks at, how wide, and its frame offset. */
export interface Pose {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
  /** Horizontal frustum offset as a fraction of width — the menu clearance. */
  frameShift: number;
}

export class RaceStartTransition {
  #elapsed = 0;
  #from: Pose = {
    position: new THREE.Vector3(),
    lookAt: new THREE.Vector3(),
    fov: 70,
    frameShift: 0,
  };
  #active = false;

  // Scratch, reused per frame rather than reallocated 60 times a second.
  #position = new THREE.Vector3();
  #lookAt = new THREE.Vector3();

  get active(): boolean {
    return this.#active;
  }

  /**
   * Begins the swing from wherever the camera currently is.
   *
   * Captures the live camera rather than recomputing the attract pose: the
   * demo's camera has its own lag and the car has moved since, so the only
   * pose guaranteed not to jump on the first frame is the one actually on
   * screen right now.
   */
  begin(camera: THREE.PerspectiveCamera, lookAt: THREE.Vector3, frameShift: number): void {
    this.#from.position.copy(camera.position);
    this.#from.lookAt.copy(lookAt);
    this.#from.fov = camera.fov;
    this.#from.frameShift = frameShift;
    this.#elapsed = 0;
    this.#active = true;
  }

  /**
   * Advances the swing and writes the camera. `to` is the chase pose for this
   * frame — recomputed by the caller as the car moves, so the transition
   * tracks a moving target rather than easing toward where the car *was* when
   * Start was pressed.
   *
   * Returns false once finished, at which point the caller hands control back
   * to CameraRig.
   */
  update(dt: number, camera: THREE.PerspectiveCamera, to: Pose, width: number, height: number): boolean {
    if (!this.#active) return false;
    this.#elapsed += dt;
    const t = Math.min(1, this.#elapsed / RACE_START_SECONDS);
    const k = ease(t);

    this.#position.copy(this.#from.position).lerp(to.position, k);
    this.#lookAt.copy(this.#from.lookAt).lerp(to.lookAt, k);
    camera.position.copy(this.#position);
    camera.lookAt(this.#lookAt);

    camera.fov = this.#from.fov + (to.fov - this.#from.fov) * k;
    // The frustum offset eases out alongside everything else. Snapping it to
    // centre at any single instant is visible as a sideways jolt of the whole
    // world, which is most of what made the old cut jarring.
    const shift = this.#from.frameShift + (to.frameShift - this.#from.frameShift) * k;
    if (Math.abs(shift) > 0.0005) {
      camera.setViewOffset(width, height, width * shift, 0, width, height);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();

    if (t >= 1) this.#active = false;
    return this.#active;
  }

  /** Where the camera ended up, for seeding CameraRig on handover. */
  get position(): THREE.Vector3 {
    return this.#position;
  }

  get lookAt(): THREE.Vector3 {
    return this.#lookAt;
  }

  cancel(): void {
    this.#active = false;
  }
}
