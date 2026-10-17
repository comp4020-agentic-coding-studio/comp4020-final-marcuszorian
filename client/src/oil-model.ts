// Flat oil-spill splatter — Obstacle 02 in the "Nightly Build" concept art.
// Non-fatal (doc/adr/0012): the model's job is to read as "glitch hazard, not
// a wall", so it borrows none of barrier-model.ts's frame/stud language and
// instead is a lane-width decal plus a slow ambient particle drift, built the
// same way barrier-model.ts builds its chevron panel — a hand-written
// procedural shader, no texture, no new dependency.
import * as THREE from "three";
import { palette } from "./palette.ts";
import { LANE_WIDTH } from "./track.ts";

const SPLAT_W = LANE_WIDTH * 0.92; // just inside the lane, same margin logic as the barrier's INNER_W
const SPLAT_D = 2.2;

const splatVertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// A soft, irregular puddle silhouette (no hard rectangle edge) with a
// glitch-vapor swirl inside it, coloured from the existing magenta/cyan/
// purple trio rather than a realistic oil-black — this is vaporwave slick,
// not a motor-oil stain.
const splatFragment = /* glsl */ `
  precision highp float;
  #include <fog_pars_fragment>
  uniform vec3 uMagenta;
  uniform vec3 uCyan;
  uniform vec3 uPurple;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 p = vUv - 0.5;
    // Lumpy radius: a few low-frequency sinusoids perturbing a circle is
    // enough to read as "splatter", not geometric, without a noise texture.
    float wobble = 0.08 * sin(atan(p.y, p.x) * 5.0 + 1.7) + 0.05 * sin(atan(p.y, p.x) * 3.0 - 0.6);
    float r = length(p * vec2(1.0, SPLAT_D_OVER_W)) - wobble;
    float puddle = 1.0 - smoothstep(0.32, 0.42, r);
    if (puddle <= 0.0) discard;

    // Interior swirl: two colour bands rotating against each other, the
    // "glitch" read the concept art wants instead of a flat fill.
    float swirl = sin((p.x * 6.0 + p.y * 4.0) + length(p) * 10.0);
    vec3 base = mix(uPurple, uMagenta, smoothstep(-1.0, 1.0, swirl));
    float vein = smoothstep(0.85, 1.0, sin(p.x * 18.0 - p.y * 11.0));
    vec3 c = mix(base, uCyan, vein * 0.6);

    gl_FragColor = vec4(c, puddle * 0.9);
    #include <fog_fragment>
  }
`;

const splatGeometry = new THREE.PlaneGeometry(SPLAT_W, SPLAT_D);
splatGeometry.rotateX(-Math.PI / 2); // lies flat on the road, like a decal

const splatMaterial = new THREE.ShaderMaterial({
  vertexShader: splatVertex,
  // SPLAT_D_OVER_W is baked in as a literal replace rather than a uniform —
  // it's a build-time constant (both dimensions are), not something that
  // ever varies per instance.
  fragmentShader: splatFragment.replace("SPLAT_D_OVER_W", (SPLAT_W / SPLAT_D).toFixed(4)),
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMagenta: { value: new THREE.Color(palette.magenta.three) },
      uCyan: { value: new THREE.Color(palette.cyan.three) },
      uPurple: { value: new THREE.Color(palette.purple.three) },
    },
  ]),
  fog: true,
  transparent: true,
  depthWrite: false, // a flat decal shouldn't occlude anything sitting right above the road
  side: THREE.DoubleSide,
  toneMapped: false,
});

// ---- ambient drift ----
// Reuses CrashBurst's point-sprite approach (crash-fx.ts) but continuous and
// much sparser: a handful of points cycling upward in a slow loop rather than
// a one-shot burst, so a resident spill reads as "venting vapor" at a glance
// without costing anything like a per-frame particle system.
const DRIFT_COUNT = 10;
const DRIFT_HEIGHT = 0.6;
const DRIFT_PERIOD = 2.4; // seconds per particle's loop

export class OilDrift {
  #geometry: THREE.BufferGeometry;
  #material: THREE.PointsMaterial;
  #positions: Float32Array;
  #phase: Float32Array;
  readonly points: THREE.Points;

  constructor() {
    this.#positions = new Float32Array(DRIFT_COUNT * 3);
    this.#phase = new Float32Array(DRIFT_COUNT);
    for (let i = 0; i < DRIFT_COUNT; i++) {
      this.#phase[i] = i / DRIFT_COUNT;
      this.#positions[i * 3] = (Math.random() - 0.5) * SPLAT_W * 0.7;
      this.#positions[i * 3 + 1] = 0;
      this.#positions[i * 3 + 2] = (Math.random() - 0.5) * SPLAT_D * 0.7;
    }
    this.#geometry = new THREE.BufferGeometry();
    this.#geometry.setAttribute("position", new THREE.BufferAttribute(this.#positions, 3));
    this.#material = new THREE.PointsMaterial({
      color: palette.laserCyan.three,
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.#geometry, this.#material);
  }

  /** Advances the loop by dt. Runs forever — call for as long as the spill mesh is resident. */
  update(dt: number): void {
    for (let i = 0; i < DRIFT_COUNT; i++) {
      this.#phase[i] = (this.#phase[i]! + dt / DRIFT_PERIOD) % 1;
      this.#positions[i * 3 + 1] = this.#phase[i]! * DRIFT_HEIGHT;
    }
    this.#geometry.attributes.position!.needsUpdate = true;
    // Fades in, holds, fades out across the loop so particles don't pop at the seam.
    const t = this.#phase[0]!;
    this.#material.opacity = 0.55 * Math.sin(Math.PI * t);
    this.#geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

/** A flat splatter plus its ambient drift, grouped so a caller places/removes
 * both together. Mirrors createBarrier()'s "one group, nothing to dispose
 * except what's per-instance" shape — here the drift's buffers ARE
 * per-instance (phase-randomised), so `dispose()` is real, unlike the shared,
 * disposal-free barrier meshes. */
export function createOilSpill(): { group: THREE.Group; drift: OilDrift; dispose(): void } {
  const group = new THREE.Group();
  const splat = new THREE.Mesh(splatGeometry, splatMaterial);
  const drift = new OilDrift();
  group.add(splat, drift.points);
  return { group, drift, dispose: () => drift.dispose() };
}
