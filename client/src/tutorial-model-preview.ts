// A small embedded viewport that renders the game's ACTUAL obstacle/pickup
// models — the same factory functions `main.ts` calls to build the live
// road (`barrier-model.ts`, `oil-model.ts`, `ramp-model.ts`,
// `coin-model.ts`) — close up and slowly turntabling, for the tutorial's
// obstacle-introduction steps. Not new art: whatever these factories build
// here is pixel-for-pixel what you'll see on the road.
//
// A second, tiny `THREE.WebGLRenderer` rather than reusing the main scene's
// camera/canvas — the main renderer is mid-frame-loop driving the live road
// behind the dimmed tutorial overlay, and borrowing it would mean fighting
// over camera position every frame two different things want to control.
// A second renderer is a few hundred KB of GPU state, trivial next to the
// main scene's.
import * as THREE from "three";
import { createBarrier, createMovingBarrier } from "./barrier-model.ts";
import { createOilSpill } from "./oil-model.ts";
import { createRamp } from "./ramp-model.ts";
import { createCoin } from "./coin-model.ts";
import { palette } from "./palette.ts";

export type PreviewKind = "barrier" | "moving-barrier" | "oil" | "ramp" | "coin";

/** Radians/sec of the oscillation's phase — not an angular speed, since the
 * motion is a sine wave, not a constant spin. */
const SPIN_SPEED = 0.5;
/** Half-width, in radians, of the turntable's swing either side of the
 * camera-facing angle (±40°) — wide enough to read as motion, narrow
 * enough to never swing past the panel-edge-on angle these flat models
 * go illegible at. */
const SPIN_ARC = (40 * Math.PI) / 180;

interface Built {
  group: THREE.Group;
  /** Per-frame hook for models with their own animation (flames, drift,
   * spin) — a no-op for the plain static barrier. */
  tick: (dt: number) => void;
  dispose: () => void;
}

function build(kind: PreviewKind): Built {
  switch (kind) {
    case "barrier": {
      const group = createBarrier();
      return { group, tick: () => {}, dispose: () => {} };
    }
    case "moving-barrier": {
      const group = createMovingBarrier();
      return { group, tick: () => {}, dispose: () => {} };
    }
    case "oil": {
      const { group, drift, dispose } = createOilSpill();
      return { group, tick: (dt) => drift.update(dt), dispose };
    }
    case "ramp": {
      const { group, flames, dispose } = createRamp();
      return { group, tick: (dt) => flames.update(dt), dispose };
    }
    case "coin": {
      const { group, update } = createCoin();
      return { group, tick: update, dispose: () => {} };
    }
  }
}

/**
 * Owns one small canvas and swaps which model it shows. `main.ts` creates
 * one instance and calls `show`/`hide` as the tutorial steps advance,
 * rather than one instance per step — a resident renderer/scene is reused,
 * only the model group inside it changes.
 */
export class ModelPreview {
  #canvas: HTMLCanvasElement;
  #renderer: THREE.WebGLRenderer;
  #scene: THREE.Scene;
  #camera: THREE.PerspectiveCamera;
  #current: Built | null = null;
  #spinGroup: THREE.Group;
  #rafHandle: number | undefined;
  #lastTime = 0;
  #spinElapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    this.#scene = new THREE.Scene();
    this.#scene.add(new THREE.AmbientLight(0x3a2a5e, 0.9));
    const key = new THREE.DirectionalLight(0xaab4ff, 1.1);
    key.position.set(3, 4, 5);
    this.#scene.add(key);

    this.#camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    this.#camera.position.set(2.4, 1.8, 3.2);
    this.#camera.lookAt(0, 0.2, 0);

    // The model groups are built already oriented for the ROAD (lying flat,
    // facing the player's approach down -z); wrapping them in a group that
    // spins on Y turntables them for a close-up view without touching
    // anything about how they're built or placed on the real road.
    this.#spinGroup = new THREE.Group();
    this.#scene.add(this.#spinGroup);
  }

  /** Sizes the canvas to its CSS box. Call after the canvas is laid out
   * (the panel it's embedded in only exists once the tutorial overlay is
   * shown) and again on resize. */
  resize(): void {
    const { clientWidth, clientHeight } = this.#canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.#renderer.setSize(clientWidth, clientHeight, false);
    this.#camera.aspect = clientWidth / clientHeight;
    this.#camera.updateProjectionMatrix();
  }

  show(kind: PreviewKind): void {
    this.#teardownCurrent();
    const built = build(kind);
    this.#current = built;
    this.#spinGroup.add(built.group);
    // Ramp/oil models sit flush with the road (y=0, decal-flat); lifting the
    // whole turntable gives the camera a clean three-quarter view instead of
    // staring down the model's own thin edge.
    this.#spinGroup.position.set(0, -0.3, 0);
    // Restarts the oscillation at its centre angle every time a new model
    // comes in, so switching steps never opens on a bad angle left over
    // from whatever the previous model was doing.
    this.#spinElapsed = 0;
    this.resize();
    if (this.#rafHandle === undefined) this.#startLoop();
  }

  hide(): void {
    this.#teardownCurrent();
    if (this.#rafHandle !== undefined) {
      cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = undefined;
    }
  }

  #teardownCurrent(): void {
    if (!this.#current) return;
    this.#spinGroup.remove(this.#current.group);
    this.#current.dispose();
    this.#current = null;
  }

  #startLoop(): void {
    this.#lastTime = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - this.#lastTime) / 1000);
      this.#lastTime = now;
      this.#spinElapsed += dt;
      // Oscillates across a wide arc rather than spinning a full 360° —
      // several of these models (barrier, moving barrier, ramp, oil) are
      // thin decal-like panels that collapse to a sliver when viewed
      // edge-on, which a full turntable inevitably passes through. Swinging
      // back and forth within ±SPIN_ARC still reads as "this is a real,
      // rotating 3D object" without ever reaching that angle.
      this.#spinGroup.rotation.y = Math.sin(this.#spinElapsed * SPIN_SPEED) * SPIN_ARC;
      this.#current?.tick(dt);
      this.#renderer.render(this.#scene, this.#camera);
      this.#rafHandle = requestAnimationFrame(tick);
    };
    this.#rafHandle = requestAnimationFrame(tick);
  }
}

/** Background fill for the preview canvas's CSS box — a sliver of the
 * road's own palette (void base) so the model doesn't float on a hard
 * rectangle, without spending a real road mesh on it. */
export const PREVIEW_BACKGROUND = palette.void.hex;
