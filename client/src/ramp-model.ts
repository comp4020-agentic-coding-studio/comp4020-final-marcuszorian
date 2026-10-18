// Trick launch ramp — Obstacle 03 in the "Nightly Build" concept art
// (doc/adr/0013). Non-fatal (same as oil, 0012): the car drives up the slope
// and launches off the lip instead of crashing. Built the same way
// barrier-model.ts builds its chevron panel — a hand-written procedural
// shader, no texture — recoloured warm/amber so a ramp reads as "launch",
// distinct from the static barrier's red and the moving barrier's
// orange/red banding. Under-ramp booster geometry and the lip flames borrow
// oil-model.ts's OilDrift pattern for the particle side.
import * as THREE from "three";
import { gunmetal, palette } from "./palette.ts";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LANE_WIDTH } from "./track.ts";

// Bounding box: lane-width-ish footprint, low at the back (z negative, where
// the car enters) rising to the lip at the front (z positive, where the car
// launches), origin at the centre so callers can sit it at y=0 on the road —
// same "origin at the centre, caller places it" convention as
// createBarrier()'s fixed box.
const RAMP_W = LANE_WIDTH * 0.92; // just inside the lane, same margin logic as the barrier's INNER_W
const RAMP_LEN = 4.4; // back to lip, along z
const RAMP_BACK_H = 0.05; // nearly flush with the road so the car can roll on
const RAMP_LIP_H = 1.1; // height of the launch lip
const RAMP_Z0 = -RAMP_LEN / 2; // back edge (low)
const RAMP_Z1 = RAMP_LEN / 2; // lip edge (high)

// ---- slope + lip geometry ----
// A single sloped quad (two triangles) from the low back edge up to the lip,
// built directly from a BufferGeometry rather than a BoxGeometry since the
// slope's top face isn't axis-aligned — the simplest shape that still reads
// as "ramp" at this game's poly budget.
function buildSlopeGeometry(): THREE.BufferGeometry {
  const halfW = RAMP_W / 2;
  // 4 corners of the top (visible, chevron-striped) face.
  const positions = new Float32Array([
    // back-left, back-right, lip-left, lip-right
    -halfW,
    RAMP_BACK_H,
    RAMP_Z0,
    halfW,
    RAMP_BACK_H,
    RAMP_Z0,
    -halfW,
    RAMP_LIP_H,
    RAMP_Z1,
    halfW,
    RAMP_LIP_H,
    RAMP_Z1,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const index = [0, 1, 2, 2, 1, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

const slopeGeometry = buildSlopeGeometry();

// Side walls (triangular profile, approximated as thin tilted boxes) so the
// ramp doesn't look like a floating sheet from the side — same "a few extra
// boxes for silhouette fidelity" level of effort as barrier-model.ts's legs.
function sideWall(sign: 1 | -1): THREE.BufferGeometry {
  const halfW = RAMP_W / 2;
  const x = sign * (halfW - 0.03);
  const positions = new Float32Array([
    x,
    0,
    RAMP_Z0,
    x,
    RAMP_BACK_H,
    RAMP_Z0,
    x,
    0,
    RAMP_Z1,
    x,
    RAMP_LIP_H,
    RAMP_Z1,
  ]);
  const index = sign > 0 ? [0, 1, 2, 2, 1, 3] : [0, 2, 1, 2, 3, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const sideGeometry = mergeGeometries([sideWall(1), sideWall(-1)]);

const sideMaterial = new THREE.MeshStandardMaterial({
  color: gunmetal.three,
  roughness: 0.5,
  side: THREE.DoubleSide,
});

// ---- under-ramp / booster-thruster block geometry ----
// Simple boxes bracing the slope from below, just for silhouette fidelity —
// not meant to be an exact structural match to the concept art's thrusters.
const THRUSTER_Y = -0.3;
const underParts = [
  box(RAMP_W * 0.9, 0.35, 0.5, 0, THRUSTER_Y, RAMP_Z0 + 0.4),
  box(0.4, 0.5, 0.4, -(RAMP_W / 2 - 0.3), THRUSTER_Y - 0.1, RAMP_Z1 - 0.3),
  box(0.4, 0.5, 0.4, RAMP_W / 2 - 0.3, THRUSTER_Y - 0.1, RAMP_Z1 - 0.3),
];
const underGeometry = mergeGeometries(underParts);
const underMaterial = new THREE.MeshStandardMaterial({
  color: gunmetal.three,
  roughness: 0.45,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

// ---- chevron panel shader, adapted from barrier-model.ts's panelFragment ----
const panelVertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// Same swept-chevron stripe math as barrier-model.ts's panelFragment, but
// warm amber/orange-red instead of the hazard barrier's flat red or the
// moving barrier's orange/red bands — a launch ramp reads "flame-adjacent",
// not "stop". uGap fades toward uOrange along vUv.y (back -> lip) so the
// panel itself hints at the flame colour waiting at the top of the slope.
const panelFragment = /* glsl */ `
  precision highp float;
  #include <fog_pars_fragment>
  uniform vec3 uGold;
  uniform vec3 uOrange;
  uniform vec3 uGap;
  varying vec2 vUv;
  void main() {
    float phase = fract(vUv.x * 7.0 - abs(vUv.y - 0.5) * 3.5);
    float stripe = smoothstep(0.42, 0.5, phase) * (1.0 - smoothstep(0.88, 0.96, phase));
    vec3 gap = mix(uGap, uOrange * 0.35, vUv.y);
    // >1.0 + toneMapped:false clips to bloom the same way barrier-model.ts's
    // panel does; uGold/uOrange are linear-converted via THREE.Color so only
    // their own channels clip, same reasoning as createBarrier()'s comment.
    vec3 c = mix(gap, uGold * 2.2, stripe);
    gl_FragColor = vec4(c, 1.0);
    #include <fog_fragment>
  }
`;

const panelGeometry = buildSlopeGeometry();
// Lift the panel a hair above the structural slope face so the chevrons
// don't z-fight it, same "recessed/offset so it reads as a distinct layer"
// idea as barrier-model.ts's panelGeometry translate.
panelGeometry.translate(0, 0.02, 0);

const panelMaterial = new THREE.ShaderMaterial({
  vertexShader: panelVertex,
  fragmentShader: panelFragment,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uGold: { value: new THREE.Color(palette.gold.three) },
      uOrange: { value: new THREE.Color(palette.orange.three) },
      uGap: { value: new THREE.Color(palette.void.three) },
    },
  ]),
  fog: true,
  side: THREE.DoubleSide,
  toneMapped: false,
});

// ---- launch-lip flames ----
// Follows OilDrift's pattern exactly: fixed particle count, BufferGeometry +
// THREE.Points, per-particle phase cycling in update(dt), opacity fade via a
// sine curve, a dispose() method. Two emitters (one per lip corner) share one
// buffer/material pair so a ramp costs one extra draw call, not two.
const FLAME_COUNT_PER_EMITTER = 8;
const FLAME_COUNT = FLAME_COUNT_PER_EMITTER * 2;
const FLAME_HEIGHT = 0.9; // upward-biased drift distance
const FLAME_SPREAD = 0.18; // lateral jitter so the flame reads as a flicker, not a single line
const FLAME_PERIOD = 0.9; // seconds per particle's loop — faster than oil's drift, flame-like

const LIP_CORNER_X = RAMP_W / 2 - 0.15;
const LIP_Z = RAMP_Z1 - 0.05;
const LIP_Y = RAMP_LIP_H;

export class RampFlames {
  #geometry: THREE.BufferGeometry;
  #material: THREE.PointsMaterial;
  #positions: Float32Array;
  #phase: Float32Array;
  #baseX: Float32Array;
  #baseZ: Float32Array;
  readonly points: THREE.Points;

  constructor() {
    this.#positions = new Float32Array(FLAME_COUNT * 3);
    this.#phase = new Float32Array(FLAME_COUNT);
    this.#baseX = new Float32Array(FLAME_COUNT);
    this.#baseZ = new Float32Array(FLAME_COUNT);
    for (let i = 0; i < FLAME_COUNT; i++) {
      const corner = i < FLAME_COUNT_PER_EMITTER ? -1 : 1;
      const local = i % FLAME_COUNT_PER_EMITTER;
      this.#phase[i] = local / FLAME_COUNT_PER_EMITTER;
      this.#baseX[i] = corner * LIP_CORNER_X + (Math.random() - 0.5) * FLAME_SPREAD;
      this.#baseZ[i] = LIP_Z + (Math.random() - 0.5) * FLAME_SPREAD;
      this.#positions[i * 3] = this.#baseX[i]!;
      this.#positions[i * 3 + 1] = LIP_Y;
      this.#positions[i * 3 + 2] = this.#baseZ[i]!;
    }
    this.#geometry = new THREE.BufferGeometry();
    this.#geometry.setAttribute("position", new THREE.BufferAttribute(this.#positions, 3));
    this.#material = new THREE.PointsMaterial({
      color: palette.gold.three,
      size: 0.26,
      transparent: true,
      opacity: 0.8,
      toneMapped: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.#geometry, this.#material);
  }

  /** Advances the loop by dt. Runs forever — call for as long as the ramp mesh is resident. */
  update(dt: number): void {
    for (let i = 0; i < FLAME_COUNT; i++) {
      this.#phase[i] = (this.#phase[i]! + dt / FLAME_PERIOD) % 1;
      const t = this.#phase[i]!;
      this.#positions[i * 3] = this.#baseX[i]! + Math.sin(t * Math.PI * 2 + i) * FLAME_SPREAD * 0.3;
      this.#positions[i * 3 + 1] = LIP_Y + t * FLAME_HEIGHT;
      this.#positions[i * 3 + 2] = this.#baseZ[i]!;
    }
    this.#geometry.attributes.position!.needsUpdate = true;
    // Fades in, holds, fades out across the loop so particles don't pop at the seam.
    const t0 = this.#phase[0]!;
    this.#material.opacity = 0.8 * Math.sin(Math.PI * t0);
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

/** A ramp slope/lip/thruster group plus its lip flames, grouped so a caller
 * places/removes both together. Mirrors createOilSpill()'s `{ group, drift,
 * dispose }` shape exactly — flames' buffers are per-instance
 * (phase-randomised), so `dispose()` is real, same as OilDrift's. */
export function createRamp(): { group: THREE.Group; flames: RampFlames; dispose: () => void } {
  const group = new THREE.Group();
  const flames = new RampFlames();
  group.add(
    new THREE.Mesh(slopeGeometry, sideMaterial),
    new THREE.Mesh(sideGeometry, sideMaterial),
    new THREE.Mesh(underGeometry, underMaterial),
    new THREE.Mesh(panelGeometry, panelMaterial),
    flames.points,
  );
  return { group, flames, dispose: () => flames.dispose() };
}
