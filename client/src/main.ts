import * as THREE from "three";
import {
  createCar,
  driftSpinAngle,
  INVINCIBLE_SECONDS,
  isDrifting,
  lateralVelocity,
  shiftLane,
  SLIDE_PEAK_SPEED,
  speedAt,
  stepCar,
} from "./car.ts";
import type { CarState, StepResult } from "./car.ts";
import { CameraRig } from "./camera-rig.ts";
import { CameraShake, CrashBurst } from "./crash-fx.ts";
import { archiveAge, DaySelector, todayUtc } from "./days.ts";
import { GhostLayer } from "./ghosts.ts";
import { getAccount, getTricks, postAccount, postRunEnd } from "./net.ts";
import type { TrickInput } from "./trick.ts";
import type { Account } from "./net.ts";
import { applyPaletteCssVars, palette, roadSurface } from "./palette.ts";
import { glslVec3 } from "./gradients.ts";
import { createGrid, updateGrid } from "./grid.ts";
import { createMountains, updateMountains } from "./mountains.ts";
import { PostFX } from "./postfx.ts";
import { Leaderboard } from "./leaderboard.ts";
import { createSky, updateSky } from "./sky.ts";
import { SpeedLines } from "./speed-lines.ts";
import { createSun, updateSun } from "./sun.ts";
import { CHUNK_LENGTH, LANE_WIDTH, movingBarrierX, ROAD_HALF_WIDTH, chunkFor } from "./track.ts";
import type { Lane, MotionParams } from "./track.ts";
import { createPlayerCar, setPlayerGhostly, setPlayerTrim } from "./car-model.ts";
import { Cosmetics } from "./cosmetics.ts";
import { CrewScreen } from "./crew-screen.ts";
import {
  applyAttractFraming,
  ATTRACT_RESPAWN_SECONDS,
  attractCameraTarget,
  attractLookAt,
  clearAttractFraming,
  createAttractKeyLight,
  createHeadlights,
  driveAttract,
  FRAME_SHIFT as ATTRACT_FRAME_SHIFT,
  setHeadlightsActive,
  updateAttractKeyLight,
} from "./attract.ts";
import { RaceStartTransition } from "./race-start.ts";
import { ScreenManager, showsAttract, simulates } from "./screens.ts";
import type { Destination, Screen } from "./screens.ts";
import { SettingsMenu } from "./settings.ts";
import { Shop } from "./shop.ts";
import { skinColor } from "./skins.ts";
import { TitleScreen } from "./title-screen.ts";
import { hasSeenTutorial, Tutorial } from "./tutorial.ts";
import { createBarrier, createMovingBarrier } from "./barrier-model.ts";
import { createOilSpill, type OilDrift } from "./oil-model.ts";
import { createRamp, type RampFlames } from "./ramp-model.ts";
import { createCoin } from "./coin-model.ts";
import {
  advanceTrick,
  createIdleTrick,
  DEFAULT_TRICK,
  startTrick,
  submitInput,
  swipeToTrickInput,
  TRICK_GLYPH,
  TRICK_WINDOW_SECONDS,
  type TrickSequence,
  type TrickState,
} from "./trick.ts";
import { AudioEngine } from "./audio.ts";
import type { Chunk } from "./track.ts";

// The 3D scene and the HUD read the same sixteen colour tokens — see
// palette.ts and plan.md. Written before anything else so there's no frame
// where the HUD shows its CSS fallback instead of the real palette.
applyPaletteCssVars();

const LOOKAHEAD_CHUNKS = 10;
const BEHIND_CHUNKS = 1;

// ---- DOM ----
const scoreEl = document.getElementById("score")!;
const coinCountEl = document.getElementById("coinCount")!;
const crashedEl = document.getElementById("crashed")!;
const oilPopupEl = document.getElementById("oilPopup")!;
const trickPromptEl = document.getElementById("trickPrompt")!;
const trickStepsEl = document.getElementById("trickSteps")!;
const trickTimerFillEl = document.getElementById("trickTimerFill") as HTMLDivElement;
const invincibleEl = document.getElementById("invincible")!;
const invincibleFillEl = document.getElementById("invincibleFill") as HTMLDivElement;
const crashedTextEl = document.getElementById("crashedText")!;
const restartButton = document.getElementById("restart") as HTMLButtonElement;
const crashedHomeButton = document.getElementById("crashedHome") as HTMLButtonElement;
const usernameModal = document.getElementById("usernameModal")!;
const usernameForm = document.getElementById("usernameForm") as HTMLFormElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const usernameError = document.getElementById("usernameError")!;
const ghostLabelsEl = document.getElementById("ghostLabels")!;
const leaderboardEl = document.getElementById("leaderboard")!;
const pauseButton = document.getElementById("pauseButton") as HTMLButtonElement;
const hudEl = document.getElementById("hud")!;
const titleEl = document.getElementById("titleScreen")!;
const pauseEl = document.getElementById("pauseMenu")!;
const crewEl = document.getElementById("crewScreen")!;
const shopEl = document.getElementById("shopScreen")!;
const cosmeticsEl = document.getElementById("cosmeticsScreen")!;
const settingsEl = document.getElementById("settings")!;

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

// Sound is the audio twin of the archive aging, so it hangs off the same
// `archiveAge(seed)` the post-processing reads (see audio.ts). A browser that
// refuses an AudioContext just stays silent — every method is a no-op then.
const audio = new AudioEngine();

// One gear, every screen. These used to be two pills parked permanently over
// the road; neither setting changed, only where you reach it from.
const settings = new SettingsMenu(settingsEl, {
  isEffectsReduced: () => !postfx.active,
  setEffectsReduced: (reduced) => postfx.setActive(!reduced),
  isMuted: () => audio.muted,
  setMuted: (muted) => {
    // Doubles as the unlock gesture: a player whose first act is this button
    // still gets audio, not a context stuck in `suspended`.
    audio.unlock();
    audio.setMuted(muted);
  },
  onBlip: () => audio.uiBlip("select"),
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
// Both models keep the exact envelopes the bare boxes had — 1.2 x 2.2 for the
// car, one lane wide and shallow in Z for the barrier — because car.ts tests
// collisions against those numbers directly (ADR 0004: what you see is what
// you hit). They are decoration over a frozen hitbox, not a physics change.
const playerCar = createPlayerCar();
scene.add(playerCar);

// Real light pools at the headlights, for the attract-mode demo. The
// headlight meshes already glow on their own; these are what make them LIGHT
// something — which now actually lands on moving road. Parented to the car so
// they travel with it, and switched off entirely during a run, where a chase
// camera never sees the pool and a 256MB box with a phone GPU feels two extra
// lights.
const headlights = createHeadlights();
playerCar.add(headlights);

// Lifts the car's near flank out of silhouette for the demo's three-quarter
// rear angle. The scene's own rim light is aimed for the dead-astern chase
// view; this is the one that follows the car.
const attractKey = createAttractKeyLight();
scene.add(attractKey, attractKey.target);

const cameraRig = new CameraRig();
// The swing from the attract camera into the chase camera when Start is
// pressed. See race-start.ts — it drives the camera itself for its duration.
const raceStart = new RaceStartTransition();
const speedLines = new SpeedLines();
scene.add(speedLines.mesh);
const cameraShake = new CameraShake();
const activeBursts: CrashBurst[] = [];

// ---- state tied to the currently-selected day ----
let seed = "";
let car: CarState = createCar();
let slide = 0; // normalised lateral velocity, for the cosmetic body roll
// `running` means "a run is alive and has not crashed" — deliberately NOT
// "the simulation is advancing". A paused run is still running; the screen
// state is what decides whether time passes. Keeping them separate is what
// stops a pause from being mistaken for a crash (and recording a score).
// Attract mode leaves this false throughout: the demo is never a run.
let running = false;
/** Seconds left on the attract demo's wreck before it restarts itself. */
let attractRespawn = 0;
/** The active (or idle) QTE trick — doc/adr/0013. Lives outside `CarState`
 * since `car.ts` has no notion of a trick catalogue; `main.ts` is the only
 * place that owns both a ramp-hit signal and the player's owned tricks. */
let trick: TrickState = createIdleTrick();
/** The ramp's lane and paired barrier distance for the currently active (or
 * just-settled) trick, or `null` when none — doc/adr/0014. `car.ts` has no
 * notion of a trick catalogue or a ramp/barrier pairing, so `main.ts` tracks
 * this itself, the same way it already owns `trick`. */
let activeRamp: { lane: Lane; barrierDistance: number } | null = null;
/** How much slower the world runs while a trick's QTE is live (doc/adr/0014)
 * — gives the player a readable window to react in, without shrinking the
 * fixed TRICK_WINDOW_SECONDS budget itself (`advanceTrick` is always fed the
 * real, unscaled `dt`). */
const TRICK_SLOWMO_FACTOR = 0.3;
/** Metres past the paired barrier's own distance the car must actually reach
 * before its exemption (`car.exemptBarrierZ`) is lifted (doc/adr/0014) —
 * enough that the car reads as having cleanly cleared the obstacle it
 * jumped, not merely drawn level with it, however slowly (slow-mo) or
 * normally it's travelling when it gets there. */
const LANDING_CLEARANCE = 2;
/** True once the active trick's bonus (if any) has been applied to
 * `car.distance`. A trick settles to "done"/"error" either inside
 * `advanceTrick` (a timeout, called from `frame()`) or inside `submitInput`
 * (a keypress, called from the keydown handler, entirely outside `frame()`'s
 * control flow) — this flag, not a same-frame "was it active a moment ago"
 * comparison, is what lets `frame()` apply the bonus exactly once no matter
 * which path produced the settled state. */
let trickSettled = true;
/** Correct inputs landed in the active trick, reset to 0 on each ramp hit —
 * `audio.trickSuccess(step)` steps a pentatonic scale up by this. */
let trickComboStep = 0;
/** Seconds left to keep showing a settled ("done"/"error") trick's outcome
 * before the prompt clears — long enough to read the clean-transition/
 * red-cross state plan.md asks for, short enough not to linger over the next
 * ramp. */
let trickHold = 0;
const TRICK_HOLD_SECONDS = 0.8;
// The trick a ramp hit plays (doc/adr/0018) — always the player's equipped
// trick, falling back to the always-free default when the server reports
// nothing equipped (a fresh account, or one from before this shipped).
let equippedTrick: TrickSequence = DEFAULT_TRICK;
/** Coins collected so far this run — folded into the balance at `postRunEnd`
 * alongside the distance, not credited coin-by-coin (doc/adr/0015). */
let runCoins = 0;

// Which full-screen surface is up. See screens.ts for why this is its own
// enum rather than a pile of booleans.
const screens = new ScreenManager(
  {
    hud: hudEl,
    title: titleEl,
    username: usernameModal,
    pause: pauseEl,
    crew: crewEl,
    shop: shopEl,
    cosmetics: cosmeticsEl,
  },
  (next) => onScreenChange(next),
);

const chunkObjects = new Map<number, THREE.Object3D>();
// The leaderboard reads the ghost set the scene draws — which, until crews
// (ADR 0011), meant the panel and the road could never disagree about who was
// on this day. That is no longer unconditionally true, and the change is
// deliberate: once you are in a crew the ROAD narrows to your crew with no
// opt-out, while the PANEL keeps a global tab. On that tab the panel fetches
// the whole day itself (`getGhosts(seed, "global")` inside leaderboard.ts)
// rather than reading the road's set, because the two are now different sets
// by design. Crew-less, the pushed set still answers both and nothing is
// fetched twice.
const leaderboard = new Leaderboard(leaderboardEl);
const ghostLayer = new GhostLayer(scene, "", ghostLabelsEl, (ghosts) => leaderboard.update(ghosts));

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

  // Moving-barrier meshes and oil drifts need a per-frame touch that a plain
  // scene traversal would be wasteful to discover by type every frame, so
  // this chunk remembers exactly which of its children need it (doc/adr/0012).
  const movingMeshes: { mesh: THREE.Object3D; lane: number; motion: MotionParams }[] = [];
  const oilDrifts: OilDrift[] = [];
  const rampFlames: RampFlames[] = [];
  // Keyed by `z` so a collected coin's mesh can be found and removed without
  // a scene-wide search — same "the chunk remembers which children need
  // special handling" reasoning as movingMeshes/oilDrifts/rampFlames above.
  const coins = new Map<number, { group: THREE.Group; update: (dt: number) => void }>();

  for (const obstacle of chunk.obstacles) {
    if (obstacle.kind === "coin") {
      const coin = createCoin();
      coin.group.position.x = obstacle.x;
      coin.group.position.z = obstacle.z;
      obj.add(coin.group);
      coins.set(obstacle.z, coin);
    } else if (obstacle.kind === "barrier") {
      const barrier = createBarrier();
      barrier.position.set(obstacle.x, 0.5, obstacle.z);
      obj.add(barrier);
    } else if (obstacle.kind === "moving-barrier" && obstacle.motion) {
      const movingBarrier = createMovingBarrier();
      movingBarrier.position.set(obstacle.x, 0.5, obstacle.z);
      obj.add(movingBarrier);
      movingMeshes.push({ mesh: movingBarrier, lane: obstacle.lane, motion: obstacle.motion });
    } else if (obstacle.kind === "oil") {
      const spill = createOilSpill();
      spill.group.position.set(obstacle.x, 0.02, obstacle.z);
      obj.add(spill.group);
      oilDrifts.push(spill.drift);
    } else if (obstacle.kind === "ramp") {
      const ramp = createRamp();
      ramp.group.position.set(obstacle.x, 0, obstacle.z);
      obj.add(ramp.group);
      rampFlames.push(ramp.flames);
    }
  }

  obj.userData.movingMeshes = movingMeshes;
  obj.userData.oilDrifts = oilDrifts;
  obj.userData.rampFlames = rampFlames;
  obj.userData.coins = coins;

  scene.add(obj);
  chunkObjects.set(index, obj);
  return obj;
}

function disposeChunk(obj: THREE.Object3D): void {
  (obj.userData.roadGeometry as THREE.BufferGeometry | undefined)?.dispose();
  for (const drift of (obj.userData.oilDrifts as OilDrift[] | undefined) ?? []) drift.dispose();
  for (const flames of (obj.userData.rampFlames as RampFlames[] | undefined) ?? []) flames.dispose();
}

/** Repositions every resident moving-barrier mesh's `x` from the car's own
 * `distance` (doc/adr/0012) and advances every resident oil spill's ambient
 * drift loop, and every resident ramp's flame emitters — called once a frame
 * from `stepAndStream` with the distance already computed that frame, never
 * from wall-clock time. */
function updateHazards(distance: number, dt: number): void {
  for (const obj of chunkObjects.values()) {
    for (const { mesh, lane, motion } of (obj.userData.movingMeshes as
      | { mesh: THREE.Object3D; lane: number; motion: MotionParams }[]
      | undefined) ?? []) {
      mesh.position.x = movingBarrierX(lane as -1 | 0 | 1, motion, distance);
    }
    for (const drift of (obj.userData.oilDrifts as OilDrift[] | undefined) ?? []) drift.update(dt);
    for (const flames of (obj.userData.rampFlames as RampFlames[] | undefined) ?? []) flames.update(dt);
    for (const coin of (obj.userData.coins as Map<number, { group: THREE.Group; update: (dt: number) => void }> | undefined)?.values() ?? [])
      coin.update(dt);
  }
}

/** Removes a collected coin's mesh from whichever resident chunk holds it —
 * `stepCar`'s collision loop only has the obstacle's `z`, not which chunk
 * object owns the mesh, so this searches the same small resident set
 * `updateHazards` already walks every frame. */
function collectCoin(z: number): void {
  for (const obj of chunkObjects.values()) {
    const coins = obj.userData.coins as Map<number, { group: THREE.Group; update: (dt: number) => void }> | undefined;
    const coin = coins?.get(z);
    if (coin) {
      obj.remove(coin.group);
      coins!.delete(z);
      runCoins++;
      coinCountEl.textContent = `${runCoins} coins`;
      audio.uiBlip("select");
      return;
    }
  }
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

function clearChunks(): void {
  for (const obj of chunkObjects.values()) {
    scene.remove(obj);
    disposeChunk(obj);
  }
  chunkObjects.clear();
}

function resetRun(): void {
  clearChunks();
  car = createCar();
  running = true;
  crashedEl.hidden = true;
  oilPopupEl.hidden = true;
  trick = createIdleTrick();
  trickSettled = true;
  trickHold = 0;
  updateTrickPrompt(trick);
  updateInvincibility();
  setPlayerGhostly(playerCar, false);
  speedLines.mesh.visible = !reducedMotion;
  for (let i = 0; i <= LOOKAHEAD_CHUNKS; i++) chunkAt(i);
  scoreEl.textContent = "0 m";
  runCoins = 0;
  coinCountEl.textContent = "0 coins";
  void refreshEquippedTrick();
}

/**
 * Re-reads which trick this account has equipped, so an equip made in
 * cosmetics draws into the very next run without needing a page reload.
 * Best-effort and non-blocking — `equippedTrick` already starts at
 * `DEFAULT_TRICK`, so a failed or slow fetch just means the run plays the
 * default, never with nothing to draw from.
 */
async function refreshEquippedTrick(): Promise<void> {
  try {
    const { tricks } = await getTricks();
    const equipped = tricks.find((t) => t.equipped);
    equippedTrick = equipped
      ? {
          id: equipped.id,
          name: equipped.name,
          steps: JSON.parse(equipped.sequence) as TrickInput[],
          bonusMetres: equipped.bonus_metres,
        }
      : DEFAULT_TRICK;
  } catch {
    // Offline or signed out — DEFAULT_TRICK is still a valid fallback.
  }
}

/**
 * Starts (or restarts) the attract-mode demo: the same car on the same
 * seeded road, driven by `driveAttract` instead of by a person.
 *
 * Deliberately shares `car`, `chunkAt` and `stepCar` with a real run rather
 * than modelling a separate "demo car". Two code paths through the physics
 * would be two chances for the title screen to drift away from the game it is
 * advertising — and the whole point of showing a live road is that it is the
 * real one. Nothing it does is recorded: `postRunEnd` only ever fires from
 * the crash branch of a `racing` frame.
 */
function startAttract(): void {
  clearChunks();
  car = createCar();
  running = false; // not a run — nothing here can be scored
  slide = 0;
  attractRespawn = 0;
  crashedEl.hidden = true;
  oilPopupEl.hidden = true;
  trick = createIdleTrick();
  trickSettled = true;
  trickHold = 0;
  updateTrickPrompt(trick);
  updateInvincibility();
  setPlayerGhostly(playerCar, false);
  // The demo is the game's own showreel, so it gets the speed lines too —
  // the one thing reducedMotion still turns off.
  speedLines.mesh.visible = !reducedMotion;
  playerCar.rotation.set(0, 0, 0);
  for (let i = 0; i <= LOOKAHEAD_CHUNKS; i++) chunkAt(i);
}

function setSeed(nextSeed: string): void {
  seed = nextSeed;
  ghostLayer.setSeed(seed);
  // The panel's global tab does its own day-scoped fetch now, so it has to be
  // told which day as well — see the comment on `leaderboard` above.
  leaderboard.setSeed(seed);
  // A day change no longer restarts a run, because you can only change days
  // from the title screen now — there is never a run in progress here. It
  // does restart the demo, which is the point: stepping back a day visibly
  // changes the road, the skyline and the grain behind the menu.
  startAttract();

  // The archive's age reaches the title screen too, not just the road: step
  // back a few weeks and the demo itself looks and sounds like the worn tape
  // ADR 0002/0003 argue the archive is, before you have pressed start.
  const age = archiveAge(seed);
  postfx.setArchiveAge(age);
  audio.setArchiveAge(age);
  audio.uiBlip("select");

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
// Lives on the title screen now: you pick the day you are about to drive,
// rather than switching mid-run and silently restarting it.
const daySelector = new DaySelector((nextSeed) => setSeed(nextSeed));

// BEFORE setSeed, not after. ScreenManager starts on `boot` without firing
// its own change handler, and setSeed builds a fresh mountain range that asks
// the screen state whether to show itself. Called the other way round, the
// very first frame is an unlit car against a full skyline, which then pops
// into the portrait once something else triggers a change.
onScreenChange("boot");

setSeed(daySelector.seed);
void daySelector.load();
ghostLayer.start();

// ---- screens ----
/**
 * Everything that has to follow the screen rather than a specific action:
 * the hero lighting, the mountains/grid the title shot deliberately omits,
 * and the one place a destination's data is refreshed on the way in.
 */
function onScreenChange(next: Screen, previous?: Screen): void {
  const demo = showsAttract(next);
  setHeadlightsActive(headlights, demo);
  attractKey.visible = demo;
  // Ghosts belong to a run, not to a showreel: the demo is not any player's
  // trace, and parking other people's cars along the road it drives would
  // read as traffic it is weaving through. Hidden, not unsubscribed — they
  // keep streaming in, so a race starts with them already in place.
  ghostLayer.setVisible(!demo);
  // The full scene now, in both modes. The grid and skyline used to be hidden
  // behind the title screen because a static camera made a scrolling grid
  // read as a bug; the camera moves now, so they are simply the game.
  grid.visible = true;
  mountains.visible = true;

  // The pause control and the settings gear trade places. Driving is the one
  // moment nobody is adjusting a setting, and it is the only moment there is
  // a run to pause — so each appears exactly when the other is useless.
  pauseButton.hidden = next !== "racing";
  settingsEl.hidden = next === "racing";
  // A panel left open as a race starts would hang over the road with no
  // button under it to close it.
  if (next === "racing") settings.close();

  if (!demo) {
    // startRace() runs the camera through a transition instead of cutting, so
    // the rig must NOT be reset here — that would discard the pose the
    // transition is easing from and snap to the chase shot, which is the jump
    // cut this replaces. Pausing is the other way in here, and there the
    // camera is already exactly where it belongs.
    clearAttractFraming(camera);
  } else if (previous !== undefined && !showsAttract(previous)) {
    // Coming back from a run (Home, or a crash): the car is sitting wherever
    // it died, so the demo starts over rather than resuming someone's wreck.
    raceStart.cancel();
    cameraRig.reset();
    startAttract();
  }

  if (next === "title") void refreshTitleAccount();
  if (next === "crew") void crewScreen.refresh();
  if (next === "shop") void shop.refresh();
  if (next === "cosmetics") void cosmetics.refresh();

  // The music plays everywhere except a crashed run — the title screen, the
  // menus, and the road all share one continuous score, so pressing Start
  // does not interrupt it. A crash is the one place silence is the point.
  audio.setMusic(next !== "racing" || running);
}

function startRace(): void {
  audio.unlock();
  // Captured BEFORE the screen changes, while the attract camera is still the
  // one on screen: the transition eases from where the camera actually is,
  // not from where the demo's pose would have put it a frame ago.
  raceStart.begin(camera, attractLookAt(car, cameraLook), ATTRACT_FRAME_SHIFT);
  resetRun();
  screens.go("racing");
}

/** Abandons whatever run is on screen and returns to the title. */
function goHome(): void {
  // Deliberately no postRunEnd: quitting has never recorded a score, and a
  // paused run that walks away shouldn't start. Only a crash records (ADR
  // 0006's "the record closes at midnight" is about which DAY counts; this
  // is about what counts as a finished run at all).
  //
  // onScreenChange restarts the demo on the way in, so there is nothing to
  // reset here — the car is about to be handed back to the autopilot.
  running = false;
  screens.go("title");
}

function pauseRace(): void {
  if (!screens.is("racing") || !running) return;
  screens.go("paused");
  audio.uiBlip("select");
}

function resumeRace(): void {
  if (!screens.is("paused")) return;
  screens.go("racing");
  audio.uiBlip("select");
}

function openDestination(destination: Destination): void {
  audio.unlock();
  screens.go(destination);
  audio.uiBlip("select");
}

// ---- input ----
// Strict single-tap (ADR 0004): one gesture is one lane, whether that gesture
// is a keypress or a swipe. Both paths below go through steer(), so the two
// cannot drift apart — there is one definition of what a lane change is, and
// one place the blip fires.
function steer(dir: -1 | 1): void {
  if (!driving()) return;
  // Oil's forced drift overrides player input for its whole window — the
  // same guard shape as `car.crashed` stopping input elsewhere (doc/adr/0012).
  // shiftLane() already no-ops during a drift; this just keeps the lane-shift
  // blip from firing for a tap that visibly did nothing.
  if (isDrifting(car)) return;
  const before = car.lane;
  shiftLane(car, dir);
  // Only when the car actually moved: shiftLane refuses past the outer lanes,
  // and a blip with no lane change reads as the input having worked.
  if (car.lane !== before) audio.laneShift();
}

/** Answers the live QTE with one token. Shared by the arrow keys and a swipe,
 * so both count a correct step the same way — one definition of "a step
 * landed" and one place the success cue fires. */
function submitTrickInput(input: TrickInput): void {
  const stepIndexBefore = trick.stepIndex;
  trick = submitInput(trick, input);
  if (trick.results[stepIndexBefore] === "correct") audio.trickSuccess(trickComboStep++);
}

/** A live, advancing run: on the racing screen, not paused, not crashed. */
function driving(): boolean {
  return running && simulates(screens.current);
}

/** Flashes per second while invincible — fast enough to read as a flicker,
 * slow enough not to strobe (doc/adr/0017). */
const INVINCIBLE_FLASH_HZ = 5;

/** Reflects `car.invincibleT` onto the HUD bar and the car's look (doc/adr/
 * 0016): the bar drains over `INVINCIBLE_SECONDS`, and the car alternates
 * between its solid and translucent looks, reusing `setPlayerGhostly`. Called
 * every frame, and once from every reset so a leftover flash can't survive a
 * restart. Reduced-motion holds the translucent look steady rather than
 * flickering it. A crashed car keeps the ghostly look the crash branch gave
 * it, so this leaves it alone. */
function updateInvincibility(): void {
  const active = car.invincibleT > 0 && !car.crashed;
  invincibleEl.hidden = !active;
  if (active) {
    invincibleFillEl.style.transform = `scaleX(${Math.min(1, car.invincibleT / INVINCIBLE_SECONDS)})`;
  }
  if (car.crashed) return;
  const elapsed = INVINCIBLE_SECONDS - car.invincibleT;
  const flashing = reducedMotion || Math.floor(elapsed * INVINCIBLE_FLASH_HZ * 2) % 2 === 0;
  setPlayerGhostly(playerCar, active && flashing);
}

/** Reflects `trick` onto `#trickPrompt` — same `panel` + `hidden` toggle
 * convention as `#oilPopup` (doc/adr/0012/0013). Shown while a QTE is
 * active, and held one extra beat on a settled outcome so the last
 * green/red step actually registers before the prompt clears (see
 * `trickHold`). Every step of the sequence is rendered at once (doc/adr/
 * 0014), rebuilt each call rather than diffed — a trick is at most
 * MAX_TRICK_STEPS steps and this only runs while one is on screen, so the
 * DOM churn is negligible. */
function updateTrickPrompt(state: TrickState): void {
  // `state.sequenceId !== ""` rules out `createIdleTrick()`'s baseline state,
  // whose `outcome` is "done" as a harmless default rather than an actual
  // settled trick — without this check the panel would show from the moment
  // a run starts, long before any ramp is ever hit.
  const visible = state.sequenceId !== "" && (state.active || state.outcome === "error" || state.outcome === "done");
  trickPromptEl.hidden = !visible;
  if (!visible) return;
  trickPromptEl.classList.toggle("trick-error", state.outcome === "error");

  trickStepsEl.textContent = "";
  state.sequence.steps.forEach((step, i) => {
    const span = document.createElement("span");
    span.className = `trick-step ${state.results[i]}`;
    span.textContent = TRICK_GLYPH[step];
    trickStepsEl.appendChild(span);
  });

  const remaining = state.active ? Math.max(0, 1 - state.windowElapsed / TRICK_WINDOW_SECONDS) : state.outcome === "done" ? 1 : 0;
  trickTimerFillEl.style.transform = `scaleX(${remaining})`;
}

// `e.repeat` is the whole point of this guard — without it, holding Left walks
// the car across the road at the OS key-repeat rate, which is neither a lane
// change nor anything the player asked for. The driving() check stays here as
// well as in steer(): it has to come before preventDefault, or an arrow key
// typed into the username field would stop moving the text caret.
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;

  if (e.key === "Escape") {
    // Settings first when it is open: one keypress, one effect. Otherwise
    // Escape is the pause toggle, and only during a race — on the title
    // screen or a destination there is no run to pause, so it does nothing
    // rather than something surprising.
    if (settings.open) {
      settings.close();
      e.preventDefault();
    } else if (screens.is("racing") && running) {
      pauseRace();
      e.preventDefault();
    } else if (screens.is("paused")) {
      resumeRace();
      e.preventDefault();
    }
    return;
  }

  if (!driving()) return;

  // A trick's input channel is additive, not a change to steering (doc/adr/
  // 0013) — but while one is live it wins over the lane-shift keys the same
  // override priority `isDrifting(car)` already gives oil's forced drift.
  if (trick.active) {
    const input =
      e.key === "ArrowUp" || e.key === "w"
        ? "up"
        : e.key === "ArrowDown" || e.key === "s"
          ? "down"
          : e.key === "ArrowLeft" || e.key === "a"
            ? "left"
            : e.key === "ArrowRight" || e.key === "d"
              ? "right"
              : null;
    if (input === null) return;
    e.preventDefault();
    submitTrickInput(input);
    return;
  }

  const dir = e.key === "ArrowLeft" || e.key === "a" ? -1 : e.key === "ArrowRight" || e.key === "d" ? 1 : 0;
  if (dir === 0) return;
  e.preventDefault();
  steer(dir);
});

// Touch: a swipe is the arrow key's mobile twin. One gesture is one answer,
// for the same reason e.repeat is guarded above — a long drag is still one
// gesture and must not walk the car across the road, so the swipe is spent
// once it fires.
//
// The gesture is answered the moment the threshold is crossed rather than on
// lift. A slide takes SLIDE_SECONDS and gates arrive a third of a second apart
// at the top of the ramp, so waiting for the finger to come up would spend most
// of the reaction window doing nothing.
//
// While a trick is live the swipe answers its QTE with a direction (up, down,
// left or right), the same as an arrow key — a trick's steps include vertical
// tokens, which a lane swipe can never produce. Otherwise a horizontal swipe
// steers, and a vertical one does nothing.
//
// Only gestures that start on the canvas steer. Everything interactive lives
// in #hud under pointer-events:auto, so a touch that starts there is someone
// reaching for a button, not driving.
const SWIPE_MIN_PX = 24; // clear of a tap's jitter, well short of a deliberate flick
let swipe: { id: number; x: number; y: number; spent: boolean } | null = null;

renderer.domElement.addEventListener("pointerdown", (e) => {
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, spent: false };
});

// Move and release listen on window, not the canvas: a finger that strays over
// the HUD mid-swipe is still the same gesture and should still steer.
window.addEventListener("pointermove", (e) => {
  if (!swipe || swipe.spent || e.pointerId !== swipe.id) return;
  if (!driving()) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  if (trick.active) {
    const input = swipeToTrickInput(dx, dy);
    if (input === null) return;
    swipe.spent = true;
    submitTrickInput(input);
    return;
  }
  // Horizontal intent: a mostly-vertical drag is not a lane change.
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
  swipe.spent = true;
  steer(dx < 0 ? -1 : 1);
});

const endSwipe = (e: PointerEvent): void => {
  if (swipe && e.pointerId === swipe.id) swipe = null;
};
window.addEventListener("pointerup", endSwipe);
window.addEventListener("pointercancel", endSwipe);

pauseButton.addEventListener("click", () => pauseRace());

restartButton.addEventListener("click", () => {
  audio.unlock();
  resetRun();
  // Already in the chase shot, so no transition — this is a restart, not an
  // arrival. onScreenChange is a no-op here too: the screen never left
  // "racing" when the car crashed.
  audio.setMusic(true);
  screens.go("racing");
});
crashedHomeButton.addEventListener("click", () => goHome());

// Autoplay policy keeps the context suspended until a gesture, and the
// username modal means the first one may be a keypress rather than a click.
for (const event of ["pointerdown", "keydown"]) {
  window.addEventListener(event, () => audio.unlock(), { once: true });
}

// Silence the game while its tab is in the background: a hidden tab should not
// keep the score playing, and the graph resumes where it stopped on return.
const syncAudioFocus = (): void => audio.setHidden(document.hidden || !document.hasFocus());
document.addEventListener("visibilitychange", syncAudioFocus);
window.addEventListener("blur", syncAudioFocus);
window.addEventListener("focus", syncAudioFocus);

// ---- title screen and its three destinations ----
let account: Account | null = null;

const titleScreen = new TitleScreen(titleEl, {
  onStart: () => startRace(),
  onDestination: (destination) => openDestination(destination),
});

const crewScreen = new CrewScreen(crewEl, {
  onCrewChange: (crew) => {
    // Joining narrows the road to the crew, unconditionally (ADR 0011). The
    // re-subscribe is what makes that happen without a reload — the server
    // re-resolves the connection's crew on every subscribe, exactly as it
    // does on a day change.
    leaderboard.setInCrew(crew !== null);
    leaderboard.setCrewMembers(crew?.members ?? []);
    ghostLayer.resubscribe();
  },
  onBlip: (kind) => audio.uiBlip(kind === "ok" ? "best" : "select"),
});

const shop = new Shop(shopEl, {
  onPurchase: (coins, skins) => {
    // The balance moved and Cosmetics has a new row to offer, so both of the
    // surfaces that show those get told rather than waiting to be reopened.
    titleScreen.setCoins(coins);
    cosmetics.render(skins);
  },
  onTrickPurchase: (coins, tricks) => {
    titleScreen.setCoins(coins);
    cosmetics.renderTricks(tricks);
  },
  onBlip: (kind) => audio.uiBlip(kind === "ok" ? "best" : "select"),
});

const cosmetics = new Cosmetics(cosmeticsEl, {
  // The hero car and the race car are the same object, so equipping a trim
  // is visible on the title screen the instant it is picked.
  onTrimChange: (skinId) => setPlayerTrim(playerCar, skinColor(skinId)),
  onBlip: (kind) => audio.uiBlip(kind === "ok" ? "best" : "select"),
});

const tutorial = new Tutorial(document.getElementById("tutorialOverlay")!, {
  goToScreen: (screen) => screens.go(screen),
  // The tour can leave the demo mid-way through a destination or paused on
  // the HUD; back to the title is the one resting screen every step can
  // safely land on, same as the screen-back buttons elsewhere.
  onFinish: () => screens.go("title"),
});
document.getElementById("howToPlay")!.addEventListener("click", () => {
  audio.uiBlip("select");
  tutorial.start();
});

// Back out of any destination to the title screen.
for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-back]")) {
  button.addEventListener("click", () => {
    screens.go("title");
    audio.uiBlip("select");
  });
}

document.getElementById("resumeRun")!.addEventListener("click", () => resumeRace());
document.getElementById("quitRun")!.addEventListener("click", () => goHome());

/** Re-reads coins and the equipped trim, which a settled payout may have moved. */
async function refreshTitleAccount(): Promise<void> {
  if (!account) return;
  try {
    const me = await getAccount();
    if (!me) return;
    account = me;
    titleScreen.setAccount(me.username, me.coins);
    setPlayerTrim(playerCar, skinColor(me.equippedSkin));
  } catch {
    // Offline — the title screen keeps the numbers it had.
  }
}

// ---- identity ----
// Who we are is the server's answer, not a guess from document.cookie — the
// token cookie is httpOnly and was never visible here. The TITLE SCREEN now
// waits behind this answer, not just the username form: a new player is asked
// for a name before they are shown anything else, and a returning one lands
// straight on the title screen with no flash of a form they already filled in.

// A `/crew/<token>` invite is a path, not a query parameter (ADR 0011). Read
// once at boot, then replaceState back to "/" so a refresh can't double-join
// — and held until an account exists, the same deferred-until-signed-in shape
// postRunEnd already uses, because joining is a write and a write needs a
// name.
const inviteMatch = location.pathname.match(/^\/crew\/([^/]+)\/?$/);
let pendingInvite = inviteMatch ? decodeURIComponent(inviteMatch[1]!) : null;
if (pendingInvite) history.replaceState(null, "", "/");

function onSignedIn(found: Account, isNewAccount = false): void {
  account = found;
  leaderboard.setViewer(found.username);
  setPlayerTrim(playerCar, skinColor(found.equippedSkin));
  titleScreen.setAccount(found.username, found.coins);

  // Resolved before the screen is chosen: landing on the title first and
  // jumping to the crew screen once the join returns would flash the title
  // screen, and a slow join would leave the invite looking ignored.
  const token = pendingInvite;
  pendingInvite = null; // one attempt per load, success or refusal
  void crewScreen.setSignedIn(true).then(async () => {
    if (token) {
      screens.go("crew");
      await crewScreen.join(token);
    } else {
      screens.go("title");
    }
    // Auto-launches once, right after a brand-new account picks a name
    // (plan.md's tutorial trigger) — not on a returning player's load, and
    // not on the "already have an account" race in the submit handler below.
    if (isNewAccount && !hasSeenTutorial()) tutorial.start();
  });
}

getAccount()
  .then((found) => {
    if (found) {
      onSignedIn(found);
    } else {
      leaderboard.setViewer(null);
      screens.go("username");
      usernameInput.focus();
    }
  })
  .catch(() => {
    // Couldn't ask (offline, server down). Don't demand a username that may
    // already be taken by this very player — show the title screen and let
    // them drive. A run post is attempted regardless and the server decides
    // whether it counts.
    screens.go("title");
  });

const usernameSubmit = usernameForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
let submittingAccount = false;
usernameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  audio.unlock();
  // Without this guard, a double-tap (easy to do on mobile, which is where
  // this first showed up) fires two submits before the first response comes
  // back: the first registers the name, the second then correctly — but
  // confusingly — gets "That username is taken" for a name you just took.
  if (submittingAccount) return;
  const name = usernameInput.value.trim();
  if (!name) return;

  submittingAccount = true;
  usernameSubmit.disabled = true;
  usernameError.textContent = "";

  postAccount(name)
    .then((created) => {
      onSignedIn(created, true); // moves to the title screen, and picks up a queued invite
    })
    .catch((err: Error) => {
      // If this browser already has an account (the exact race above, or a
      // retry after a success that didn't visibly register), there's
      // nothing wrong to report — just proceed.
      if (account) {
        onSignedIn(account);
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
let audioMusic = false;
// Reused every frame rather than allocated: this runs 60 times a second, and
// two fresh Vector3s per frame is garbage the collector has to chase.
const cameraTarget = new THREE.Vector3();
const cameraLook = new THREE.Vector3();

/**
 * Advances the car one step and keeps the road streamed around it. Shared by
 * a real run and the attract demo, so the two can never disagree about
 * physics, collision, or how far ahead the road exists.
 *
 * Returns the frame's `StepResult` — `crashed` true the frame the car
 * crashes, `rampHit` true the frame it first touches a ramp.
 */
function stepAndStream(dt: number): StepResult {
  const currentIndex = Math.floor(car.distance / CHUNK_LENGTH);
  const nearby = [
    ...(chunkObjects.has(currentIndex) ? chunkFor(seed, currentIndex).obstacles : []),
    ...(chunkObjects.has(currentIndex + 1) ? chunkFor(seed, currentIndex + 1).obstacles : []),
  ];

  const previousOffset = car.offset;
  const wasDrifting = isDrifting(car);
  const result = stepCar(car, dt, nearby);
  if (!wasDrifting && isDrifting(car)) audio.oilSlip();
  for (const z of result.coinsCollected) collectCoin(z);
  // Normalised lateral velocity drives the body roll — see CameraRig.updateCarBank.
  slide = Math.max(-1, Math.min(1, lateralVelocity(car, previousOffset, dt) / SLIDE_PEAK_SPEED));

  const nextIndex = Math.floor(car.distance / CHUNK_LENGTH);
  for (let i = nextIndex; i <= nextIndex + LOOKAHEAD_CHUNKS; i++) chunkAt(i);
  pruneChunks(nextIndex);
  updateHazards(car.distance, dt);

  return result;
}

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

  const attracting = showsAttract(screens.current);

  // The demo drives the same car, over the same seeded road, through the same
  // stepCar — the only difference is who chooses the lane. A separate "demo
  // physics" path would be a second chance for the title screen to drift from
  // the game it is advertising.
  if (attracting) {
    if (car.crashed) {
      // The autopilot is good, not perfect, and a generated pattern can demand
      // a shift it cannot make in time. Rather than fake invulnerability, it
      // crashes like a player would and the demo starts over.
      attractRespawn -= dt;
      if (attractRespawn <= 0) startAttract();
    } else {
      driveAttract(car, seed);
      stepAndStream(dt);
      // Attract mode never engages a trick — the autopilot now actively
      // steers clear of ramps when the road is open (doc/adr/0019) and still
      // drives over one when real hazards leave no safer lane, but either
      // way this branch has no ramp-hit signal to act on.
      if (car.crashed) {
        attractRespawn = ATTRACT_RESPAWN_SECONDS;
        setPlayerGhostly(playerCar, true);
        speedLines.mesh.visible = false;
        const burst = new CrashBurst(new THREE.Vector3(car.offset, 0.6, -car.distance));
        scene.add(burst.points);
        activeBursts.push(burst);
        // No audio.crash() and no camera shake: the demo plays behind a menu
        // someone may be reading, and a bang plus a jolt from a car they are
        // not driving is startling rather than atmospheric.
      }
    }
  }

  if (driving()) {
    // The world runs in slow motion while a trick's QTE is live or still
    // being held on screen (doc/adr/0014) — scaled dt drives the car/stream
    // step and the camera target below, but `advanceTrick` always gets the
    // real `dt` so the reaction window stays a fixed wall-clock budget rather
    // than stretching along with the slow-mo.
    const simDt = trick.active || trickHold > 0 ? dt * TRICK_SLOWMO_FACTOR : dt;
    const result = stepAndStream(simDt);
    const justCrashed = result.crashed;

    if (result.rampHit && !trick.active && result.ramp) {
      trick = startTrick(equippedTrick);
      trickSettled = false;
      trickComboStep = 0;
      activeRamp = result.ramp;
      car.exemptBarrierZ = -result.ramp.barrierDistance;
      audio.rampLaunch();
    }
    if (trick.active) trick = advanceTrick(trick, dt);
    // Not `trick.active` alone: `submitInput` (keydown handler, below) can
    // settle the trick to "done"/"error" outside this function entirely, so
    // `trickSettled` is what actually tracks "has the bonus been applied
    // yet," independent of which path produced the settled outcome.
    if (!trick.active && !trickSettled) {
      // The car settles into the paired barrier's lane unconditionally — a
      // failed or timed-out trick still lands in the lane it jumped
      // (doc/adr/0014) — but keeps travelling at its own pace rather than
      // being teleported forward: `car.exemptBarrierZ` stays set below until
      // the car naturally reaches the barrier, so there's nothing to crash
      // into in the meantime.
      if (activeRamp && car.lane !== activeRamp.lane) {
        car.lane = activeRamp.lane;
        car.slideFrom = car.offset;
        car.slideT = 0;
      }
      if (trick.outcome === "done") {
        car.distance += trick.sequence.bonusMetres;
        car.invincibleT = INVINCIBLE_SECONDS;
        audio.trickComplete();
      } else {
        audio.trickFail();
      }
      trickSettled = true;
      trickHold = TRICK_HOLD_SECONDS;
    } else if (!trick.active && trickHold > 0) {
      trickHold = Math.max(0, trickHold - dt);
      if (trickHold === 0) trick = createIdleTrick();
    }
    // Keeps the jumped barrier exempt from collision until the car has
    // actually travelled far enough to clear it, however long that takes at
    // whatever pace it's moving (doc/adr/0014) — not tied to the trick's own
    // settling frame, since slow-mo means the car is often still well short
    // of the barrier when the QTE itself finishes.
    if (activeRamp && car.distance >= activeRamp.barrierDistance + LANDING_CLEARANCE) {
      car.exemptBarrierZ = null;
      activeRamp = null;
    }

    // Real, unscaled dt (doc/adr/0017): wall-clock seconds, not
    // seconds of slow-mo world time.
    car.invincibleT = Math.max(0, car.invincibleT - dt);
    updateInvincibility();

    scoreEl.textContent = `${Math.floor(car.distance)} m`;
    // Pure readout of car.ts's own drift state — no new state here, just a
    // `hidden` toggle mirroring how `#crashed` is shown (doc/adr/0012).
    oilPopupEl.hidden = !isDrifting(car);
    updateTrickPrompt(trick);

    if (justCrashed) {
      running = false;
      crashedEl.hidden = false;
      // A drift that carried the car into a barrier can still be mid-window
      // when the crash lands; the crashed panel is the one that matters now.
      oilPopupEl.hidden = true;
      trick = createIdleTrick();
      trickSettled = true;
      trickHold = 0;
      car.exemptBarrierZ = null;
      activeRamp = null;
      updateTrickPrompt(trick);
      car.invincibleT = 0;
      invincibleEl.hidden = true;
      setPlayerGhostly(playerCar, true);
      // The rushing-past streaks read as the car's own speed; a dead car
      // isn't going anywhere, so they cut out the instant it crashes rather
      // than keep streaming past a stationary ghost.
      speedLines.mesh.visible = false;
      audio.crash();
      // ADR 0006: a past day is a read-only archive, so say so at the moment
      // it matters. Silently not saving would read as a bug — the player just
      // crashed and would reasonably expect a trace.
      const onToday = seed === todayUtc();
      crashedTextEl.textContent = onToday
        ? `crashed at ${Math.floor(car.distance)} m`
        : `crashed at ${Math.floor(car.distance)} m (archive run, not recorded)`;

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
        postRunEnd(car.distance, car.offset, seed, runCoins)
          .then((result) => {
            if (result.improved) {
              audio.uiBlip("best");
              void daySelector.load();
            }
            // Coins credit every run, not just an improved one (doc/adr/0015)
            // — on top of ADR 0010's own reason for this refresh (any request
            // can be the one that settles a closed day), a run with coins but
            // no new best still just moved the balance.
            if (result.improved || result.coinsCollected > 0) void refreshTitleAccount();
          })
          .catch(() => {
            // best-effort — a failed save doesn't block playing again
          });
      }
    }
  }

  const speed = speedAt(car.distance);
  const x = car.offset;
  const z = -car.distance;
  playerCar.position.set(x, 0.5, z);
  // Oil's forced drift spins the car a full 360 — see car.ts's driftSpinAngle
  // doc comment for why this is linear, not eased, and sign-matched to the
  // drift's direction.
  playerCar.rotation.y = driftSpinAngle(car);

  if (attracting) {
    // Banking still applies: the demo's lane changes are real slides, and a
    // car that changed lanes without leaning would look like it was sliding
    // on ice. It stops rolling once wrecked, same as a crashed player's.
    cameraRig.updateCarBank(playerCar, car.crashed ? 0 : slide, dt);
    const portrait = window.innerHeight > window.innerWidth;
    cameraRig.updateCamera(
      camera,
      dt,
      attractCameraTarget(car, cameraTarget, portrait),
      attractLookAt(car, cameraLook),
      speed,
    );
    updateAttractKeyLight(attractKey, car);
    // Pushes everything rendered to the left, clearing the right-hand half
    // for the menu — without moving or aiming the camera, either of which
    // would rotate the composed shot.
    applyAttractFraming(camera, window.innerWidth, window.innerHeight);
    camera.updateProjectionMatrix();
    // No cameraShake here: a jolt behind a menu reads as a glitch.
  } else if (raceStart.active) {
    // Swinging from the demo's shot into the chase shot. The target is
    // recomputed every frame rather than fixed at the moment Start was
    // pressed, because the car is still driving the whole way through — ease
    // toward a stale pose and the camera lands behind where the car now is.
    cameraRig.updateCarBank(playerCar, driving() ? slide : 0, dt);
    const stillGoing = raceStart.update(
      dt,
      camera,
      {
        position: cameraTarget.set(x, 4.5, z + 7),
        lookAt: cameraLook.set(x, 0.5, z - 10),
        fov: CameraRig.chaseFov(speed),
        frameShift: 0, // the chase shot is centred
      },
      window.innerWidth,
      window.innerHeight,
    );
    if (!stillGoing) {
      // Hand back to the rig, seeded with where the transition actually
      // ended. Without this the rig still believes the camera is wherever it
      // was before Start and yanks it back on the very next frame.
      cameraRig.placeAt(camera, raceStart.position, raceStart.lookAt, camera.fov);
    }
  } else {
    // Banking follows the slide only while time is passing — a paused car
    // holds its roll instead of unwinding it, so resuming picks up mid-slide
    // rather than snapping upright first.
    cameraRig.updateCarBank(playerCar, driving() ? slide : 0, dt);
    cameraRig.updateCamera(
      camera,
      dt,
      cameraTarget.set(x, 4.5, z + 7),
      cameraLook.set(x, 0.5, z - 10),
      speed,
      driving() && trick.active,
    );
    if (!reducedMotion) camera.position.add(cameraShake.update(dt, elapsed));
  }

  updateSky(sky, camera);
  updateSun(sun, camera);
  updateGrid(grid, camera);
  updateMountains(mountains, camera);
  // Name tags reach exactly as far as the road does: LOOKAHEAD_CHUNKS is the
  // number of chunks built ahead of the car, so this is the span that is
  // always drawn (the car sits somewhere inside its own chunk, so the real
  // road edge is this to this + CHUNK_LENGTH).
  ghostLayer.update(dt, camera, window.innerWidth, window.innerHeight, LOOKAHEAD_CHUNKS * CHUNK_LENGTH);

  // The score plays under the title screen, its menus and the road alike —
  // one continuous piece of music, so pressing Start does not interrupt it
  // and arriving back at the menu does not restart it. Silent only on a
  // crashed run, where the wreck is the point.
  //
  // Derived every frame rather than latched at each transition, so a pause, a
  // crash, the username prompt and a day switch all agree without each having
  // to remember to say so.
  const wantMusic = !(screens.is("racing") && !running);
  if (wantMusic !== audioMusic) {
    audioMusic = wantMusic;
    audio.setMusic(wantMusic);
  }

  const speedFactor = Math.max(0, Math.min(1.5, (speed - 9) / 30));
  if (speedLines.mesh.visible) speedLines.update(dt, speedFactor, camera.position);
  // The engine filter and the ghost swell both want 0..1; speedFactor runs to
  // 1.5 so the speed lines keep thickening past the point the audio tops out.
  // Ghost proximity is a RUN's business: the demo drives past other people's
  // traces constantly and swelling a pad for each would be meaningless.
  audio.update(
    dt,
    Math.min(1, speedFactor),
    driving() ? ghostLayer.nearness(car.distance, car.offset) : 0,
  );

  for (let i = activeBursts.length - 1; i >= 0; i--) {
    if (!activeBursts[i]!.update(dt)) {
      scene.remove(activeBursts[i]!.points);
      activeBursts.splice(i, 1);
    }
  }

  postfx.render(dt);
}

requestAnimationFrame(frame);
