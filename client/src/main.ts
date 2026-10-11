import * as THREE from "three";
import { createCar, lateralVelocity, shiftLane, SLIDE_PEAK_SPEED, speedAt, stepCar } from "./car.ts";
import type { CarState } from "./car.ts";
import { CameraRig } from "./camera-rig.ts";
import { CameraShake, CrashBurst } from "./crash-fx.ts";
import { archiveAge, DaySelector, todayUtc } from "./days.ts";
import { GhostLayer } from "./ghosts.ts";
import { getAccount, postAccount, postRunEnd } from "./net.ts";
import type { Account } from "./net.ts";
import { applyPaletteCssVars, palette, roadSurface } from "./palette.ts";
import { glslVec3 } from "./gradients.ts";
import { createGrid, updateGrid } from "./grid.ts";
import { createMountains, updateMountains } from "./mountains.ts";
import { PostFX } from "./postfx.ts";
import { Roster } from "./roster.ts";
import { createSky, updateSky } from "./sky.ts";
import { SpeedLines } from "./speed-lines.ts";
import { createSun, updateSun } from "./sun.ts";
import { CHUNK_LENGTH, LANE_WIDTH, ROAD_HALF_WIDTH, chunkFor } from "./track.ts";
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
const ghostLabelsEl = document.getElementById("ghostLabels")!;
const fxToggle = document.getElementById("fxToggle") as HTMLButtonElement;
const rosterEl = document.getElementById("roster")!;

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
const sun = createSun();
scene.add(sun);
const grid = createGrid();
scene.add(grid);
// Reseeded per day in setSeed — each day's archive gets a different skyline.
let mountains = createMountains("");
scene.add(mountains);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const postfx = new PostFX(renderer, scene, camera, { reducedEffects: reducedMotion });

function syncFxToggle(): void {
  const reduced = !postfx.active;
  fxToggle.setAttribute("aria-pressed", String(reduced));
  fxToggle.textContent = reduced ? "effects reduced" : "reduce effects";
}
syncFxToggle();
fxToggle.addEventListener("click", () => {
  postfx.setActive(!postfx.active);
  syncFxToggle();
});

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

// DoubleSide is no longer load-bearing now the centerline is straight (ADR
// 0004 retired the per-chunk drift that made winding order vary), but the
// road is only ever viewed from above and the cost is nil, so it stays as
// cheap insurance against a flipped winding in a future geometry change.
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
      // edgeDist is 0 at the centreline, 1 at either road edge — symmetric,
      // so one expression paints both of a mirrored pair.
      float edgeDist = abs(vUv.x - 0.5) * 2.0;
      float edge = smoothstep(0.84, 0.97, edgeDist);
      // The two lane dividers (ADR 0004): lane edges at x = ±LANE_WIDTH/2 on a
      // road of half-width ROAD_HALF_WIDTH, i.e. edgeDist 0.3. Interpolated as
      // a literal rather than a uniform — both are compile-time constants, and
      // this material is shared by every chunk.
      float divider = smoothstep(0.035, 0.0, abs(edgeDist - ${(LANE_WIDTH / 2 / ROAD_HALF_WIDTH).toFixed(4)}));
      float dash = step(0.5, fract(vUv.y * 6.0)) * divider;
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
// Lane-filling hazard barriers (ADR 0004): the box is exactly one lane wide,
// which is also car.ts's collision half-width — what you see is what you hit.
// Shallow in Z so a row of them reads as a gate to thread, not a wall.
const obstacleGeometry = new THREE.BoxGeometry(LANE_WIDTH, 1, 0.8);
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

const cameraRig = new CameraRig();
const speedLines = new SpeedLines();
scene.add(speedLines.mesh);
const cameraShake = new CameraShake();
const activeBursts: CrashBurst[] = [];

// ---- state tied to the currently-selected day ----
let seed = "";
let car: CarState = createCar();
let slide = 0; // normalised lateral velocity, for the cosmetic body roll
let running = false;

const chunkObjects = new Map<number, THREE.Object3D>();
// The roster reads the same ghost set the scene draws, so the panel and the
// road can never disagree about who is on this day.
const roster = new Roster(rosterEl);
const ghostLayer = new GhostLayer(scene, "", ghostLabelsEl, (ghosts) => roster.update(ghosts));

function chunkAt(index: number): THREE.Object3D {
  let obj = chunkObjects.get(index);
  if (obj) return obj;

  const chunk: Chunk = chunkFor(seed, index);
  obj = new THREE.Group();

  const start = index * CHUNK_LENGTH;
  const end = start + CHUNK_LENGTH;
  const geometry = new THREE.BufferGeometry();
  // A flat rectangle: ADR 0004 straightened the centerline, so the trapezoidal
  // strip that used to follow the seeded drift is gone.
  const positions = new Float32Array([
    -ROAD_HALF_WIDTH, 0, -start,
    ROAD_HALF_WIDTH, 0, -start,
    -ROAD_HALF_WIDTH, 0, -end,
    ROAD_HALF_WIDTH, 0, -end,
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
  postfx.setArchiveAge(archiveAge(seed));

  scene.remove(mountains);
  for (const child of mountains.children) {
    const mesh = child as THREE.Mesh;
    (mesh.material as THREE.Material).dispose();
  }
  (mountains.children[0] as THREE.Mesh | undefined)?.geometry.dispose();
  mountains = createMountains(seed);
  scene.add(mountains);
}

// ---- day selector ----
const daySelector = new DaySelector((nextSeed) => setSeed(nextSeed));
setSeed(daySelector.seed);
void daySelector.load();
ghostLayer.start();

// ---- input ----
// Strict single-tap (ADR 0004): one keypress is one lane. `e.repeat` is the
// whole point of the guard — without it, holding Left walks the car across
// the road at the OS key-repeat rate, which is neither a lane change nor
// anything the player asked for.
window.addEventListener("keydown", (e) => {
  if (e.repeat || !running || !usernameModal.hidden) return;
  const dir = e.key === "ArrowLeft" || e.key === "a" ? -1 : e.key === "ArrowRight" || e.key === "d" ? 1 : 0;
  if (dir === 0) return;
  e.preventDefault();
  shiftLane(car, dir);
});

restartButton.addEventListener("click", () => resetRun());

// ---- username gate ----
// Who we are is the server's answer, not a guess from document.cookie — the
// token cookie is httpOnly and was never visible here. Until the answer lands
// the modal stays hidden and the game plays; a returning player sees no flash
// of a form they already filled in, and a new one gets it a round trip later.
let account: Account | null = null;
getAccount()
  .then((found) => {
    account = found;
    if (!found) usernameModal.hidden = false;
  })
  .catch(() => {
    // Couldn't ask (offline, server down). Don't demand a username that may
    // already be taken by this very player — let them drive. The run post
    // below is attempted regardless and the server decides whether it counts.
  });
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
    .then((created) => {
      account = created;
      usernameModal.hidden = true;
      // Start them at 0: the loop was running while we asked the server who
      // they were, so without this their first run begins a metre or two in.
      resetRun();
    })
    .catch((err: Error) => {
      // If this browser already has an account (the exact race above, or a
      // retry after a success that didn't visibly register), there's
      // nothing wrong to report — just proceed.
      if (account) {
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
let elapsed = 0;
speedLines.mesh.visible = !reducedMotion;

function frame(now: number): void {
  requestAnimationFrame(frame);
  // Clamped at BOTH ends. The upper clamp is for a backgrounded tab; the lower
  // one is for the first frame: `lastTime` is set when this module finishes
  // evaluating, but rAF hands back the timestamp of the frame it is already
  // rendering, which can PREDATE that. A negative dt drove distance below zero,
  // and speedAt's sqrt then turned it to NaN for the rest of the session. This
  // hid behind the username modal (which paused the loop until the clock caught
  // up) until that modal stopped appearing on every load.
  const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
  lastTime = now;
  elapsed += dt;

  if (running && usernameModal.hidden) {
    const currentIndex = Math.floor(car.distance / CHUNK_LENGTH);
    const nearby = [
      ...(chunkObjects.has(currentIndex) ? chunkFor(seed, currentIndex).obstacles : []),
      ...(chunkObjects.has(currentIndex + 1) ? chunkFor(seed, currentIndex + 1).obstacles : []),
    ];

    const previousOffset = car.offset;
    const justCrashed = stepCar(car, dt, nearby);
    // Normalised lateral velocity drives the body roll — see CameraRig.updateCarBank.
    slide = Math.max(-1, Math.min(1, lateralVelocity(car, previousOffset, dt) / SLIDE_PEAK_SPEED));

    const nextIndex = Math.floor(car.distance / CHUNK_LENGTH);
    for (let i = nextIndex; i <= nextIndex + LOOKAHEAD_CHUNKS; i++) chunkAt(i);
    pruneChunks(nextIndex);

    scoreEl.textContent = `${Math.floor(car.distance)} m`;

    if (justCrashed) {
      running = false;
      crashedEl.hidden = false;
      // ADR 0006: a past day is a read-only archive, so say so at the moment
      // it matters. Silently not saving would read as a bug — the player just
      // crashed and would reasonably expect a trace.
      const onToday = seed === todayUtc();
      crashedTextEl.textContent = onToday
        ? `crashed at ${Math.floor(car.distance)} m`
        : `crashed at ${Math.floor(car.distance)} m — archive run, not recorded`;

      const burst = new CrashBurst(new THREE.Vector3(car.offset, 0.6, -car.distance));
      scene.add(burst.points);
      activeBursts.push(burst);
      if (!reducedMotion) cameraShake.add(0.9);

      // Only today's track records. The server refuses a past day with a 403
      // regardless (ADR 0006); not sending it is the client agreeing rather
      // than the client being trusted.
      //
      // Identity is still not checked here: the server owns it, so a
      // signed-out browser gets a 401 and the catch swallows it. The old
      // `if (hasAccount())` gate meant to express that and never once was
      // true, so no run was ever saved from a real browser.
      if (onToday) {
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

  const x = car.offset;
  const z = -car.distance;
  const speed = speedAt(car.distance);
  carMesh.position.set(x, 0.5, z);
  cameraRig.updateCarBank(carMesh, running ? slide : 0, dt);
  cameraRig.updateCamera(
    camera,
    dt,
    new THREE.Vector3(x, 4.5, z + 7),
    new THREE.Vector3(x, 0.5, z - 10),
    speed,
  );
  if (!reducedMotion) camera.position.add(cameraShake.update(dt, elapsed));

  updateSky(sky, camera);
  updateSun(sun, camera);
  updateGrid(grid, camera);
  updateMountains(mountains, camera);
  ghostLayer.update(dt, camera, window.innerWidth, window.innerHeight);

  if (speedLines.mesh.visible) {
    const speedFactor = Math.max(0, Math.min(1.5, (speed - 9) / 30));
    speedLines.update(dt, speedFactor, camera.position);
  }

  for (let i = activeBursts.length - 1; i >= 0; i--) {
    if (!activeBursts[i]!.update(dt)) {
      scene.remove(activeBursts[i]!.points);
      activeBursts.splice(i, 1);
    }
  }

  postfx.render(dt);
}

requestAnimationFrame(frame);
