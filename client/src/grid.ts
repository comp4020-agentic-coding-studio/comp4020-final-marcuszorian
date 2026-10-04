// Procedural, infinite-looking ground grid. A single large plane, shader-
// drawn so distant lines don't alias the way a textured or line-segment grid
// would (plan.md explicitly rules out THREE.GridHelper for exactly this: no
// fade, no anti-aliasing, aliases badly at distance), with lines faded to
// *transparent* — not to a flat colour — at the horizon, which is what
// avoids a visible seam against the sky.
//
// The plane is repositioned under the camera every frame (updateGrid),
// exactly like the sky dome. The fragment shader reads true world-space XZ
// (passed through via the model matrix) to decide where the lines fall, so
// re-centering the mesh doesn't reset the pattern — the lines stay fixed in
// the world and simply scroll past as the camera moves forward. That's the
// entire "grid scrolling toward you" effect; no separate distance uniform is
// needed on top of it.
import * as THREE from "three";
import { glslVec3, gradientAlphaGlsl, gradientGlsl, gridGradientStops } from "./gradients.ts";
import { palette } from "./palette.ts";

const GRID_SIZE = 500; // plane extends this far in every direction from the camera
const CELL_MINOR = 8; // metres per fine (cyan) line
const CELL_MAJOR = CELL_MINOR * 5; // metres per coarse (magenta) line — 5x keeps them coincident
const FADE_DISTANCE = 150; // roughly the fog's far distance

const vertexShader = /* glsl */ `
  varying vec2 vWorldXZ;
  varying vec2 vLocalXZ;
  void main() {
    vLocalXZ = position.xz;
    vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vWorldXZ;
  varying vec2 vLocalXZ;

  // Anti-aliased, distance-stable grid line mask: one line stays ~1px wide
  // at any distance, via the screen-space derivative of the cell coordinate
  // (the standard fwidth trick for a shader grid).
  float gridMask(vec2 worldXZ, float cell) {
    vec2 c = worldXZ / cell;
    vec2 d = fwidth(c);
    vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-4));
    return 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  }

  void main() {
    float dist = length(vLocalXZ);
    float t = clamp(dist / ${FADE_DISTANCE.toFixed(1)}, 0.0, 1.0);
    ${gradientGlsl(gridGradientStops, "t", "lineColor")}
    ${gradientAlphaGlsl(gridGradientStops, "t", "fadeAlpha")}

    float minor = gridMask(vWorldXZ, ${CELL_MINOR.toFixed(1)});
    float major = gridMask(vWorldXZ, ${CELL_MAJOR.toFixed(1)});

    const vec3 majorColor = ${glslVec3(palette.magenta.hex)};
    vec3 color = mix(lineColor, majorColor, major * 0.6);
    float alpha = max(minor, major * 0.35) * fadeAlpha;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color * 1.1, alpha);
  }
`;

export function createGrid(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(GRID_SIZE * 2, GRID_SIZE * 2, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    toneMapped: false, // the near lines deliberately push bright enough to bloom
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -0.5;
  mesh.frustumCulled = false;
  return mesh;
}

/** Keeps the grid centred under the camera, at ground level. Call once per frame. */
export function updateGrid(grid: THREE.Object3D, camera: THREE.Camera): void {
  grid.position.set(camera.position.x, -0.03, camera.position.z);
}
