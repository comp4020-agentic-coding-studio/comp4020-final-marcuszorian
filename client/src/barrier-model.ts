// Low-poly hazard barricade (replaces the bare lane-wide box). Every
// geometry and material is built once at module scope and shared by all
// barrier instances, so a field of barriers costs no extra GPU memory.
//
// Bounding box is fixed by physics: x ±1.2 (the lane width, which is also
// car.ts's collision half-width — what you see is what you hit), y ±0.5,
// z ±0.4, origin at the centre so callers can sit it at y=0.5 on the road.
import * as THREE from "three";
import { gunmetal, palette } from "./palette.ts";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const POST_W = 0.16;
const RAIL_H = 0.12;
const FRAME_Z0 = 0; // the frame fills the front half; the legs own the back half
const FRAME_Z1 = 0.4;
const FRAME_D = FRAME_Z1 - FRAME_Z0;
const FRAME_ZC = (FRAME_Z0 + FRAME_Z1) / 2;
const INNER_W = 2.4 - 2 * POST_W;
const INNER_H = 1 - 2 * RAIL_H;

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

const frameParts = [
  box(2.4, RAIL_H, FRAME_D, 0, 0.5 - RAIL_H / 2, FRAME_ZC),
  box(2.4, RAIL_H, FRAME_D, 0, -0.5 + RAIL_H / 2, FRAME_ZC),
  box(POST_W, INNER_H, FRAME_D, -(1.2 - POST_W / 2), 0, FRAME_ZC),
  box(POST_W, INNER_H, FRAME_D, 1.2 - POST_W / 2, 0, FRAME_ZC),
];

// Legs run from the back of each post down to a foot planted at z = -0.4.
// Built from the end points so the splay can be tuned without redoing trig.
function leg(x: number): THREE.BufferGeometry {
  const top = new THREE.Vector2(0.25, 0); // (y, z) at the post's back face
  const bot = new THREE.Vector2(-0.44, -0.3);
  const len = top.distanceTo(bot);
  const g = new THREE.BoxGeometry(0.1, 0.1, len);
  // BoxGeometry's long axis is Z; tilt it so it spans top -> bot in the YZ plane.
  g.rotateX(Math.atan2(-(top.x - bot.x), top.y - bot.y));
  g.translate(x, (top.x + bot.x) / 2, (top.y + bot.y) / 2);
  return g;
}

const legParts = [
  leg(-(1.2 - POST_W / 2)),
  leg(1.2 - POST_W / 2),
  box(0.16, 0.05, 0.16, -(1.2 - POST_W / 2), -0.475, -0.32),
  box(0.16, 0.05, 0.16, 1.2 - POST_W / 2, -0.475, -0.32),
];

// Sits inside the front face of the frame so the studs can't poke past z = 0.4.
const STUD = 0.07;
const studParts = [-1, 1].flatMap((sx) =>
  [-1, 1].map((sy) =>
    box(STUD, STUD, STUD, sx * (1.2 - POST_W / 2), sy * (0.5 - RAIL_H / 2), FRAME_Z1 - STUD / 2),
  ),
);

// Recessed 0.1 behind the frame's front face so the chevrons read as inset.
const panelGeometry = new THREE.PlaneGeometry(INNER_W, INNER_H);
panelGeometry.translate(0, 0, FRAME_Z1 - 0.1);

const edgeGeometries = frameParts.map((g) => new THREE.EdgesGeometry(g));

const frameMaterial = new THREE.MeshStandardMaterial({
  color: gunmetal.three,
  // Nothing in this scene supplies an envMap, so metalness here would darken
  // the frame toward black rather than make it look like metal.
  roughness: 0.55,
  // Keeps the cyan edge lines from z-fighting the box edges they trace.
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

const studMaterial = new THREE.MeshBasicMaterial({ color: palette.gold.three, toneMapped: false });
studMaterial.color.multiplyScalar(1.6);

const edgeMaterial = new THREE.LineBasicMaterial({ color: palette.cyan.three, toneMapped: false });
// Lines are 1px in WebGL whatever linewidth says; pushing past 1.0 is what lets bloom fatten them.
edgeMaterial.color.set(palette.cyan.three).multiplyScalar(1.4);

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

const panelFragment = /* glsl */ `
  precision highp float;
  #include <fog_pars_fragment>
  uniform vec3 uRed;
  uniform vec3 uGap;
  varying vec2 vUv;
  void main() {
    // Swept chevron: the stripe phase shifts with distance from the panel's
    // horizontal midline, so each stripe bends into a "<" pointing sideways.
    float phase = fract(vUv.x * 7.0 - abs(vUv.y - 0.5) * 3.5);
    float stripe = smoothstep(0.42, 0.5, phase) * (1.0 - smoothstep(0.88, 0.96, phase));
    // >1.0 + toneMapped:false is what clears the bloom threshold. Safe to push
    // this hard *because* uRed is linear: red's green and blue channels are
    // genuinely near-zero there, so scaling clips only the red channel and the
    // hazard stays red. Baking the hex straight in via glslVec3 (as the sky and
    // grid do) hands the composer sRGB numbers it treats as linear, and those
    // channels sit near 0.3 — scaling them washed the chevrons out to salmon.
    vec3 c = mix(uGap, uRed * 2.2, stripe);
    gl_FragColor = vec4(c, 1.0);
    #include <fog_fragment>
  }
`;

const panelMaterial = new THREE.ShaderMaterial({
  vertexShader: panelVertex,
  fragmentShader: panelFragment,
  // THREE.Color converts a hex out of sRGB into the renderer's linear working
  // space on construction, which is the conversion glslVec3 does not do.
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uRed: { value: new THREE.Color(palette.red.three) }, uGap: { value: new THREE.Color(palette.void.three) } },
  ]),
  fog: true,
  side: THREE.DoubleSide, // so the back doesn't look hollow once you've driven past
  toneMapped: false,
});

// Merged down to one geometry per material. Around 25 barriers are resident
// at once (11 chunks of lookahead, a gate every ~17m), so the seventeen
// draw calls an unmerged barrier would cost are the frame budget, not noise.
const frameGeometry = mergeGeometries([...frameParts, ...legParts]);
const studGeometry = mergeGeometries(studParts);
const edgeGeometry = mergeGeometries(edgeGeometries);

export function createBarrier(): THREE.Group {
  // Nothing per-instance is allocated (all geometry/materials are shared), so there is nothing to dispose.
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(frameGeometry, frameMaterial),
    new THREE.Mesh(studGeometry, studMaterial),
    new THREE.LineSegments(edgeGeometry, edgeMaterial),
    new THREE.Mesh(panelGeometry, panelMaterial),
  );
  return group;
}
