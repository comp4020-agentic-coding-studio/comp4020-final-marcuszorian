import * as THREE from "three";
import { createCar, stepCar, worldX } from "./car.ts";
import type { CarState } from "./car.ts";
import { DaySelector } from "./days.ts";
import { GhostLayer } from "./ghosts.ts";
import { hasAccount, postAccount, postRunEnd } from "./net.ts";
import { applyPaletteCssVars, palette, roadSurface } from "./palette.ts";
import { glslVec3 } from "./gradients.ts";
import { PostFX } from "./postfx.ts";
import { createSky, updateSky } from "./sky.ts";
import { CHUNK_LENGTH, ROAD_HALF_WIDTH, centerXAtDistance, chunkFor } from "./track.ts";
import type { Chunk } from "./track.ts";

// The 3D scene and the HUD read the same sixteen colour tokens — see
// palette.ts and plan.md. Written before anything else so there's no frame
// where the HUD shows its CSS fallback instead of the real palette.
applyPaletteCssVars();

const LOOKAHEAD_CHUNKS = 10;
const BEHIND_CHUNKS = 1;

// ---- DOM ----
const scoreEl = document.getElementById("score")!;
const crashedEl = document.getElementById("crashed")!;
const crashedTextEl = document.getElementById("crashedText")!;
const restartButton = document.getElementById("restart") as HTMLButtonElement;
const usernameModal = document.getElementById("usernameModal")!;
const usernameForm = document.getElementById("usernameForm") as HTMLFormElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const usernameError = document.getElementById("usernameError")!;

// ---- three.js scene ----
const scene = new THREE.Scene();
// The gradient sky (below) is what's actually visible; this is just the
// fallback for the instant before it's added and for anything the dome
// doesn't cover.
scene.background = new THREE.Color(palette.void.three);
// Fog colour must equal the sky gradient's *horizon* stop, not its zenith —
// otherwise geometry dissolves into a visibly different colour than the sky
// it's fading into. See gradients.ts's skyGradientStops (the 100% stop).
scene.fog = new THREE.Fog(palette.orange.three, 30, 140);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
const BASE_FOV = 70;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Clamped below the usual 2x: this runs on a 256MB Fly box serving phones,
// and the post-processing stack below roughly doubles the per-pixel cost.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
// ACES, not the default (or Reinhard): Reinhard desaturates magenta toward
// grey-pink, which is the most common way this aesthetic gets ruined.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const sky = createSky();
scene.add(sky);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const postfx = new PostFX(renderer, scene, camera, { reducedEffects: reducedMotion });

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);

// A cool, dim ambient plus a cooler rim light — the old flat-white pair
// washed every emissive colour toward grey. Lighting and materials are free
// to change (plan.md constraint #1); track geometry is not.
scene.add(new THREE.AmbientLight(0x3a2a5e, 0.5));
const rim = new THREE.DirectionalLight(0xaab4ff, 0.6);
rim.position.set(10, 20, 10);
scene.add(rim);

// DoubleSide: the strip's winding order varies with drift direction per
// chunk, so a front-face-only material would make the road flicker in and
// out depending on which way it curves. Simpler and more robust than getting
// winding exactly right for every drift sign.
const roadMaterial = new THREE.MeshStandardMaterial({ color: roadSurface.three, side: THREE.DoubleSide });
// Forces three's standard UV varyings to exist even though this material has
// no texture map — onBeforeCompile below reads vUv to paint edge lines and
// centre dashes directly onto the road surface. See plan.md Phase 2 ("Road
// treatment") and doc/adr/0003-visual-direction.md.
roadMaterial.defines = { USE_UV: "" };
roadMaterial.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <opaque_fragment>",
    /* glsl */ `
    {
      // vUv.x: 0 at the road's left edge, 1 at its right edge (see the uv
      // attribute added in chunkAt). vUv.y: 0..1 along each 20m chunk.
      float edgeDist = abs(vUv.x - 0.5) * 2.0;
      float edge = smoothstep(0.84, 0.97, edgeDist);
      float centreMask = smoothstep(0.09, 0.0, edgeDist);
      float dash = step(0.5, fract(vUv.y * 6.0)) * centreMask;
      vec3 neon = ${glslVec3(palette.cyan.hex)} * 1.5;
      // Added to outgoingLight (pre-tonemap, linear HDR) rather than to
      // gl_FragColor directly: at this point in the standard fragment chunk
      // chain, tonemapping hasn't run yet, so this can genuinely push over
      // 1.0 and bloom like a real emissive, instead of just brightening an
      // already-clamped pixel.
      outgoingLight += neon * (edge + dash * 0.8);
    }
    #include <opaque_fragment>
    `,
  );
};
const obstacleGeometry = new THREE.BoxGeometry(1.2, 1, 1.2);
const obstacleMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a0509,
  emissive: palette.red.three,
  emissiveIntensity: 0.85,
});
const carMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a0510,
  emissive: palette.magenta.three,
  emissiveIntensity: 0.9,
});

const carMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 2.2), carMaterial);
scene.add(carMesh);

// ---- state tied to the currently-selected day ----
let seed = "";
let car: CarState = createCar();
let steer = 0;
let running = false;

const chunkObjects = new Map<number, THREE.Object3D>();
const ghostLayer = new GhostLayer(scene, "");

function chunkAt(index: number): THREE.Object3D {
  let obj = chunkObjects.get(index);
  if (obj) return obj;

  const chunk: Chunk = chunkFor(seed, index);
  obj = new THREE.Group();

  const start = index * CHUNK_LENGTH;
  const end = start + CHUNK_LENGTH;
  const x0 = centerXAtDistance(seed, start);
  const x1 = centerXAtDistance(seed, end);
  const geometry = new THREE.BufferGeometry();
  // A trapezoidal strip following the centerline, rather than a flat
  // rectangle, so the road visibly curves with the seeded drift.
  const positions = new Float32Array([
    x0 - ROAD_HALF_WIDTH, 0, -start,
    x0 + ROAD_HALF_WIDTH, 0, -start,
    x1 - ROAD_HALF_WIDTH, 0, -end,
    x1 + ROAD_HALF_WIDTH, 0, -end,
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  // u: 0 at the road's left edge, 1 at its right edge. v: 0..1 along this
  // chunk. Adding UVs doesn't move a single vertex, so ADR 0002's seeded
  // geometry contract holds — this only feeds roadMaterial's onBeforeCompile
  // edge/dash overlay above.
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  obj.add(new THREE.Mesh(geometry, roadMaterial));
  // Tagged so pruneChunks/resetRun can dispose exactly this geometry — it's
  // the only part of a chunk that isn't shared across chunks (obstacles all
  // reuse one global geometry+material, same as the player car).
  obj.userData.roadGeometry = geometry;

  for (const obstacle of chunk.obstacles) {
    const mesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
    mesh.position.set(obstacle.x, 0.5, obstacle.z);
    obj.add(mesh);
  }

  scene.add(obj);
  chunkObjects.set(index, obj);
  return obj;
}

function disposeChunk(obj: THREE.Object3D): void {
  (obj.userData.roadGeometry as THREE.BufferGeometry | undefined)?.dispose();
}

function pruneChunks(currentIndex: number): void {
  for (const [index, obj] of chunkObjects) {
    if (index < currentIndex - BEHIND_CHUNKS || index > currentIndex + LOOKAHEAD_CHUNKS) {
      scene.remove(obj);
      disposeChunk(obj);
      chunkObjects.delete(index);
    }
  }
}

function resetRun(): void {
  for (const obj of chunkObjects.values()) {
    scene.remove(obj);
    disposeChunk(obj);
  }
  chunkObjects.clear();
  car = createCar();
  running = true;
  crashedEl.hidden = true;
  for (let i = 0; i <= LOOKAHEAD_CHUNKS; i++) chunkAt(i);
}

function setSeed(nextSeed: string): void {
  seed = nextSeed;
  ghostLayer.setSeed(seed);
  resetRun();
}

// ---- day selector ----
const daySelector = new DaySelector((nextSeed) => setSeed(nextSeed));
setSeed(daySelector.seed);
void daySelector.load();
ghostLayer.start();

// ---- input ----
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));

restartButton.addEventListener("click", () => resetRun());

// ---- username gate ----
if (!hasAccount()) {
  usernameModal.hidden = false;
}
const usernameSubmit = usernameForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
let submittingAccount = false;
usernameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  // Without this guard, a double-tap (easy to do on mobile, which is where
  // this first showed up) fires two submits before the first response comes
  // back: the first registers the name, the second then correctly — but
  // confusingly — gets "that username is taken" for a name you just took.
  if (submittingAccount) return;
  const name = usernameInput.value.trim();
  if (!name) return;

  submittingAccount = true;
  usernameSubmit.disabled = true;
  usernameError.textContent = "";

  postAccount(name)
    .then(() => {
      usernameModal.hidden = true;
    })
    .catch((err: Error) => {
      // If this browser already has an account (the exact race above, or a
      // retry after a success that didn't visibly register), there's
      // nothing wrong to report — just proceed.
      if (hasAccount()) {
        usernameModal.hidden = true;
        return;
      }
      usernameError.textContent = err.message;
    })
    .finally(() => {
      submittingAccount = false;
      usernameSubmit.disabled = false;
    });
});

// ---- game loop ----
let lastTime = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (running && usernameModal.hidden) {
    steer = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);

    const currentIndex = Math.floor(car.distance / CHUNK_LENGTH);
    const nearby = [
      ...(chunkObjects.has(currentIndex) ? chunkFor(seed, currentIndex).obstacles : []),
      ...(chunkObjects.has(currentIndex + 1) ? chunkFor(seed, currentIndex + 1).obstacles : []),
    ];

    const justCrashed = stepCar(seed, car, steer, dt, nearby);

    const nextIndex = Math.floor(car.distance / CHUNK_LENGTH);
    for (let i = nextIndex; i <= nextIndex + LOOKAHEAD_CHUNKS; i++) chunkAt(i);
    pruneChunks(nextIndex);

    scoreEl.textContent = `${Math.floor(car.distance)} m`;

    if (justCrashed) {
      running = false;
      crashedEl.hidden = false;
      crashedTextEl.textContent = `crashed at ${Math.floor(car.distance)} m`;
      if (hasAccount()) {
        postRunEnd(car.distance, car.offset, seed)
          .then((result) => {
            if (result.improved) void daySelector.load();
          })
          .catch(() => {
            // best-effort — a failed save doesn't block playing again
          });
      }
    }
  }

  const x = worldX(seed, car);
  const z = -car.distance;
  carMesh.position.set(x, 0.5, z);
  camera.position.set(x, 4.5, z + 7);
  camera.lookAt(x, 0.5, z - 10);

  updateSky(sky, camera);

  postfx.render(dt);
}

requestAnimationFrame(frame);
