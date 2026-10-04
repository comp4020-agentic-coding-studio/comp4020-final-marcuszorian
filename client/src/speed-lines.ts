// Speed-line streaks that rush past the camera — the classic "warp speed"
// cue. Short line segments with positions rewritten each frame; no texture,
// no new dependency, consistent with plan.md's "nothing here needs an asset".
import * as THREE from "three";
import { palette } from "./palette.ts";

const COUNT = 120;
const SPREAD_X = 20;
const SPREAD_Y = 7;
const MIN_Z = -55;
const MAX_Z = -3;
const BASE_SPEED = 38; // relative streak speed, independent of the car's own speed scale

interface Particle {
  x: number;
  y: number;
  z: number;
}

export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  #particles: Particle[] = [];
  #positions: Float32Array;
  #geometry: THREE.BufferGeometry;

  constructor() {
    for (let i = 0; i < COUNT; i++) this.#particles.push(SpeedLines.#respawn());
    this.#positions = new Float32Array(COUNT * 2 * 3);
    this.#geometry = new THREE.BufferGeometry();
    this.#geometry.setAttribute("position", new THREE.BufferAttribute(this.#positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: palette.hotWhite.three,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
    });
    this.mesh = new THREE.LineSegments(this.#geometry, material);
    this.mesh.frustumCulled = false;
  }

  static #respawn(): Particle {
    return {
      x: (Math.random() - 0.5) * SPREAD_X,
      y: Math.random() * SPREAD_Y,
      z: MIN_Z - Math.random() * 40,
    };
  }

  /** `speedFactor` is roughly 0..1.5, how fast the car is going relative to its own range. */
  update(dt: number, speedFactor: number, anchor: THREE.Vector3): void {
    const step = BASE_SPEED * (0.3 + speedFactor) * dt;
    for (let i = 0; i < this.#particles.length; i++) {
      const p = this.#particles[i]!;
      const tailZ = p.z;
      p.z += step;
      if (p.z > MAX_Z) Object.assign(p, SpeedLines.#respawn());
      const base = i * 6;
      this.#positions[base] = anchor.x + p.x;
      this.#positions[base + 1] = anchor.y + p.y;
      this.#positions[base + 2] = anchor.z + tailZ;
      this.#positions[base + 3] = anchor.x + p.x;
      this.#positions[base + 4] = anchor.y + p.y;
      this.#positions[base + 5] = anchor.z + p.z;
    }
    this.#geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.#geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
