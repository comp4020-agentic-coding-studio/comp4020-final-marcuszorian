// The gradient sky dome. A large sphere, rendered from the inside
// (`BackSide`), that follows the camera every frame so it always surrounds
// the player regardless of how far the car has driven — the same trick every
// skybox uses, because the sphere's *direction* from its own centre is all
// the shader needs, and that's invariant under translating the whole sphere
// to sit on the camera.
//
// Deliberately rendered at <=1.0 intensity (no emissive push, no bloom
// contribution): per plan.md, a blooming sky would wash out the sun and
// become the brightest thing on screen instead of it.
import * as THREE from "three";
import { glslVec3, gradientGlsl, skyGradientStops } from "./gradients.ts";
import { palette } from "./palette.ts";

const SKY_RADIUS = 300;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // The sphere is re-centred on the camera every frame (see updateSky), so
    // object-space position *is* the direction from the viewer — no need to
    // go through the model matrix.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vDir;

  void main() {
    float h = vDir.y;
    vec3 above;
    {
      // u: 0 at the zenith, 1 at the horizon — matches the sky gradient
      // table in gradients.ts, which is written zenith-first.
      float u = 1.0 - clamp(h, 0.0, 1.0);
      ${gradientGlsl(skyGradientStops, "u", "c")}
      above = c;
    }
    // Below the horizon there's no more gradient data — without this, every
    // direction under the horizon would render the *last* stop (full-
    // saturation orange) flatly, which (since the ground grid's gaps are
    // transparent and show the sky straight through) looked like a solid
    // orange floor eating most of the frame and dragging bloom's threshold
    // over nearly the whole screen. Fading quickly toward the void instead
    // reads as ground haze, and leaves only a thin, genuinely bright band
    // right at the horizon — which is what should glow.
    vec3 below = mix(${glslVec3(palette.orange.hex)}, ${glslVec3(palette.void.hex)}, clamp(-h / 0.09, 0.0, 1.0));
    vec3 col = h >= 0.0 ? above : below;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false, // the gradient's exact stops are the point; don't let ACES reshape them
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

/** Keeps the dome centred on the camera. Call once per frame. */
export function updateSky(sky: THREE.Object3D, camera: THREE.Camera): void {
  sky.position.copy(camera.position);
}
