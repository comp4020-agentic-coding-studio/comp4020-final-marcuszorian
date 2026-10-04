// A low-poly wireframe mountain silhouette on the horizon, reseeded per day
// so each day's archive has a visibly different skyline — a small, free way
// to make "today" and "three weeks ago" look like different places, which is
// the whole point of the archive (see plan.md, "Age the archive").
// Positioned like the sky and sun: it follows the camera, always sitting on
// the horizon rather than being a real object the track could curve away
// from.
import * as THREE from "three";
import { hashString, mulberry32 } from "./track.ts";
import { palette } from "./palette.ts";

const SEGMENTS = 28;
const SPAN = 900; // total width covered, metres
const MAX_HEIGHT = 34;
const BASE_Y = -6; // sinks well below the grid so there's no seam at the base
const FORWARD_OFFSET = 260;

function buildRidgeGeometry(seed: string): THREE.BufferGeometry {
  const rng = mulberry32(hashString(`${seed}:mountains`));
  const heights: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) heights.push(rng() * MAX_HEIGHT);

  const positions: number[] = [];
  const step = SPAN / SEGMENTS;
  for (let i = 0; i < SEGMENTS; i++) {
    const x0 = -SPAN / 2 + i * step;
    const x1 = x0 + step;
    const h0 = heights[i]!;
    const h1 = heights[i + 1]!;
    // Two triangles per column: a silhouette climbing from BASE_Y (below the
    // grid) up to this seed's ridge height.
    positions.push(x0, BASE_Y, 0, x0, h0, 0, x1, BASE_Y, 0);
    positions.push(x1, BASE_Y, 0, x0, h0, 0, x1, h1, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

export function createMountains(seed: string): THREE.Group {
  const geometry = buildRidgeGeometry(seed);
  const group = new THREE.Group();

  // A flat, unlit silhouette (purple — "far field, must not bloom") plus a
  // brighter wireframe laid over it, which is what actually reads as
  // "wireframe mountains" against the gradient sky rather than a flat shape.
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: palette.purple.three, fog: true }));
  const wire = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: palette.violet.three, wireframe: true, transparent: true, opacity: 0.55 }),
  );
  wire.renderOrder = 1;
  group.add(fill, wire);
  group.renderOrder = -0.8;
  group.traverse((obj) => {
    obj.frustumCulled = false;
  });
  return group;
}

/** Keeps the ridge on the horizon ahead of the camera. Call once per frame. */
export function updateMountains(mountains: THREE.Object3D, camera: THREE.Camera): void {
  mountains.position.set(camera.position.x, 0, camera.position.z - FORWARD_OFFSET);
}
