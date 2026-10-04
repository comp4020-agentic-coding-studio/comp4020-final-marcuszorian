// Crash feel: a particle burst and trauma-based camera shake. Trauma decays
// and shake is driven by trauma *squared*, not trauma itself, so the shake
// falls off smoothly instead of cutting out abruptly — the standard
// technique from game-feel writing on screenshake (see plan.md Phase 4).
import * as THREE from "three";
import { palette } from "./palette.ts";

const BURST_COUNT = 48;
const BURST_LIFETIME = 0.7; // seconds

export class CrashBurst {
  #positions: Float32Array;
  #velocities: Float32Array;
  #geometry: THREE.BufferGeometry;
  #material: THREE.PointsMaterial;
  readonly points: THREE.Points;
  #age = 0;

  constructor(origin: THREE.Vector3) {
    this.#positions = new Float32Array(BURST_COUNT * 3);
    this.#velocities = new Float32Array(BURST_COUNT * 3);
    for (let i = 0; i < BURST_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 4 + Math.random() * 7;
      this.#velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.#velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed * 0.8 + 1.5;
      this.#velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
      this.#positions[i * 3] = origin.x;
      this.#positions[i * 3 + 1] = origin.y;
      this.#positions[i * 3 + 2] = origin.z;
    }
    this.#geometry = new THREE.BufferGeometry();
    this.#geometry.setAttribute("position", new THREE.BufferAttribute(this.#positions, 3));
    this.#material = new THREE.PointsMaterial({
      color: palette.gold.three,
      size: 0.6,
      transparent: true,
      opacity: 1,
      toneMapped: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.#geometry, this.#material);
  }

  /** Advances the burst by dt. Returns false once it's finished (and disposed). */
  update(dt: number): boolean {
    this.#age += dt;
    const t = this.#age / BURST_LIFETIME;
    if (t >= 1) {
      this.dispose();
      return false;
    }
    for (let i = 0; i < BURST_COUNT; i++) {
      this.#velocities[i * 3 + 1] -= 9.8 * dt; // gravity
      this.#positions[i * 3] += this.#velocities[i * 3] * dt;
      this.#positions[i * 3 + 1] += this.#velocities[i * 3 + 1] * dt;
      this.#positions[i * 3 + 2] += this.#velocities[i * 3 + 2] * dt;
    }
    this.#geometry.attributes.position!.needsUpdate = true;
    this.#material.opacity = 1 - t;
    return true;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

export class CameraShake {
  #trauma = 0;
  #seedOffset = Math.random() * 1000;

  add(amount: number): void {
    this.#trauma = Math.min(1, this.#trauma + amount);
  }

  /** Call once per frame; returns this frame's camera offset. */
  update(dt: number, elapsed: number): THREE.Vector3 {
    this.#trauma = Math.max(0, this.#trauma - dt * 2.2);
    const shake = this.#trauma * this.#trauma;
    if (shake <= 0) return new THREE.Vector3();
    const t = elapsed + this.#seedOffset;
    const x = (noise1(t * 11) - 0.5) * 2 * shake * 0.6;
    const y = (noise1(t * 13 + 7) - 0.5) * 2 * shake * 0.4;
    return new THREE.Vector3(x, y, 0);
  }
}

// A cheap single-octave pseudo-noise — not Perlin, just a smoothed hash, but
// continuous enough that shake reads as a tremor rather than jitter.
function noise1(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i);
  const b = hash(i + 1);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
