import * as THREE from "three";
import { createCar, stepCar, worldX } from "./car.ts";
import type { CarState } from "./car.ts";
import { DaySelector } from "./days.ts";
import { GhostLayer } from "./ghosts.ts";
import { hasAccount, postAccount, postRunEnd } from "./net.ts";
import { CHUNK_LENGTH, ROAD_HALF_WIDTH, centerXAtDistance, chunkFor } from "./track.ts";
import type { Chunk } from "./track.ts";

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
scene.background = new THREE.Color(0x0a0c10);
scene.fog = new THREE.Fog(0x0a0c10, 30, 140);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(10, 20, 10);
scene.add(sun);

const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x24262e });
const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0xff5a5a });
const carMaterial = new THREE.MeshStandardMaterial({ color: 0x5aff9a });

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
  obj.add(new THREE.Mesh(geometry, roadMaterial));

  for (const obstacle of chunk.obstacles) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), obstacleMaterial);
    mesh.position.set(obstacle.x, 0.5, obstacle.z);
    obj.add(mesh);
  }

  scene.add(obj);
  chunkObjects.set(index, obj);
  return obj;
}

function pruneChunks(currentIndex: number): void {
  for (const [index, obj] of chunkObjects) {
    if (index < currentIndex - BEHIND_CHUNKS || index > currentIndex + LOOKAHEAD_CHUNKS) {
      scene.remove(obj);
      chunkObjects.delete(index);
    }
  }
}

function resetRun(): void {
  for (const obj of chunkObjects.values()) scene.remove(obj);
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

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
