// The banded, gradient sun. A billboard kept at a fixed offset ahead of and
// centred on the camera (like the sky, it's really part of the skybox — see
// updateSun), so it reads as a fixed feature of the horizon rather than an
// object in the world the curving track could carry out of view.
//
// Deliberately the single brightest thing in the scene (toneMapped: false,
// colour pushed well over 1.0) — per plan.md, it's what the bloom pass
// should anchor on, not the sky or the grid.
import * as THREE from "three";
import { gradientGlsl, sunGradientStops } from "./gradients.ts";

// Square, so the shader's UV-space circular mask below renders as a true
// circle — a non-square plane stretched it into an oval. Width is kept at
// its old value and height grows to match (rather than shrinking width to
// the old 95), keeping the sun's horizontal prominence in frame.
const SUN_WIDTH = 150;
const SUN_HEIGHT = 150;
const SUN_FORWARD_OFFSET = 260; // metres ahead of the camera
// Raised along with the taller disc so the now-bigger sun still clears the
// horizon the same way the old 95-tall disc did, rather than sinking lower
// into frame.
const SUN_HEIGHT_OFFSET = 48; // metres above camera height

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    if (length(p) > 0.5) discard;

    float t = 1.0 - vUv.y; // 0 at the top — sunGradientStops is written top-first
    ${gradientGlsl(sunGradientStops, "t", "sunColor")}

    // Horizontal band cutouts through the lower ~40% of the disc, gaps
    // widening toward the bottom — the classic outrun "segmented sun".
    float v = vUv.y;
    if (v < 0.42) {
      float band = (0.42 - v) / 0.42;
      float phase = fract(v * 10.0 * (1.0 + band * 1.5));
      float gapWidth = 0.18 + band * 0.4;
      if (step(gapWidth, phase) < 0.5) discard;
    }

    gl_FragColor = vec4(sunColor * 1.05, 1.0);
  }
`;

export function createSun(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(SUN_WIDTH, SUN_HEIGHT);
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, toneMapped: false, fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -0.9;
  mesh.frustumCulled = false;
  return mesh;
}

/** Keeps the sun centred ahead of the camera, like a skybox element. Call once per frame. */
export function updateSun(sun: THREE.Object3D, camera: THREE.Camera): void {
  sun.position.set(camera.position.x, SUN_HEIGHT_OFFSET, camera.position.z - SUN_FORWARD_OFFSET);
}
