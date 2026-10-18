// Coin pickup — Asset 04 in the concept art: a low-poly coin that spins in
// place, Subway-Surfers style. Built the same way oil/ramp build their
// panels — a hand-written procedural shader, no texture — recoloured gold
// rim with a magenta/violet cyber-chip face so it reads as "currency", not
// another hazard.
import * as THREE from "three";
import { palette } from "./palette.ts";

const COIN_RADIUS = 0.42;
const COIN_THICKNESS = 0.1;
const COIN_Y = 0.9; // floats at roughly bumper height, Subway-Surfers style
const SPIN_SPEED = 2.6; // radians/sec

const faceVertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// A chip glyph (a small square) on a magenta/violet disc, gold rim handled by
// a separate TorusGeometry mesh rather than in-shader, since a rim is already
// a clean primitive.
const faceFragment = /* glsl */ `
  precision highp float;
  #include <fog_pars_fragment>
  uniform vec3 uMagenta;
  uniform vec3 uViolet;
  uniform vec3 uGold;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p);
    if (r > 0.46) discard;
    vec3 base = mix(uViolet, uMagenta, smoothstep(0.0, 0.46, r));
    float chip = step(abs(p.x), 0.1) * step(abs(p.y), 0.1);
    vec3 c = mix(base, uGold * 1.6, chip);
    gl_FragColor = vec4(c, 1.0);
    #include <fog_fragment>
  }
`;

const faceGeometry = new THREE.CircleGeometry(COIN_RADIUS, 16);
const faceMaterial = new THREE.ShaderMaterial({
  vertexShader: faceVertex,
  fragmentShader: faceFragment,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uMagenta: { value: new THREE.Color(palette.magenta.three) },
      uViolet: { value: new THREE.Color(palette.violet.three) },
      uGold: { value: new THREE.Color(palette.gold.three) },
    },
  ]),
  fog: true,
  side: THREE.DoubleSide,
  toneMapped: false,
});

const rimGeometry = new THREE.TorusGeometry(COIN_RADIUS * 0.95, COIN_THICKNESS / 2, 8, 16);
const rimMaterial = new THREE.MeshStandardMaterial({
  color: palette.gold.three,
  emissive: palette.gold.three,
  emissiveIntensity: 0.6,
  roughness: 0.35,
});

/** One spinning coin. `update(dt)` advances the spin; `collected` marks it
 * removed from the scene — `main.ts` checks it once per frame rather than
 * mutating the scene graph from inside car.ts's collision loop. */
export function createCoin(): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();
  group.position.y = COIN_Y;
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  group.add(face, rim);

  function update(dt: number): void {
    group.rotation.y += SPIN_SPEED * dt;
  }

  return { group, update };
}
