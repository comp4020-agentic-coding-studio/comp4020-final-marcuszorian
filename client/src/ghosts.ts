// Translucent cars at other players' best-of-the-day crash points — the
// single most important object in the scene (see plan.md: "the ghost is the
// single most important object on screen"). Synced by push: a run that ends
// anywhere reaches every open session watching that day inside a second, over
// the socket in net.ts (see doc/adr/0005-realtime-ghosts.md). Polling is still
// here, but only as the fallback while that socket is down.
//
// Each ghost gets its own material (a small hue variance around lavender,
// seeded from the username) rather than sharing one, so a row of ghosts
// reads as distinct presences rather than identical clones, plus a name
// label projected into screen space every frame. No collision against
// them — they were never solid, and that's deliberate: insubstantial,
// something you drive past, not an obstacle.
import * as THREE from "three";
import { hashString, LANE_WIDTH, laneX, snapToLane } from "./track.ts";
import { getGhosts, LiveFeed } from "./net.ts";
import type { Ghost } from "./net.ts";
import { palette } from "./palette.ts";
import { createGhostCar, disposeCarModel } from "./car-model.ts";

// Only used while the live socket is down, so it is tighter than the old
// steady-state poll — this is a degraded mode, not the normal one.
const POLL_MIN_MS = 20_000;
const POLL_JITTER_MS = 20_000;
// Metres of road over which a ghost fades up to full presence.
const NEARNESS_RANGE = 14;
const BOB_HEIGHT = 0.08;
const BOB_SPEED = 1.4;

const lavenderHsl = new THREE.Color(palette.lavender.three).getHSL({ h: 0, s: 0, l: 0 });

interface GhostEntry {
  mesh: THREE.Group;
  label: HTMLDivElement;
  phase: number;
  /** The run this ghost stands for — the leaderboard reads it; the scene doesn't. */
  ghost: Ghost;
}

export class GhostLayer {
  #scene: THREE.Scene;
  #labelContainer: HTMLElement;
  #entries = new Map<string, GhostEntry>();
  #seed: string;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #clock = 0;
  #live: LiveFeed;
  #liveOpen = false;
  #onChange: ((ghosts: Ghost[]) => void) | undefined;

  constructor(
    scene: THREE.Scene,
    seed: string,
    labelContainer: HTMLElement,
    onChange?: (ghosts: Ghost[]) => void,
  ) {
    this.#scene = scene;
    this.#seed = seed;
    this.#labelContainer = labelContainer;
    this.#onChange = onChange;
    this.#live = new LiveFeed({
      onGhosts: (_seed, ghosts) => this.#render(ghosts),
      onGhost: (_seed, ghost) => this.#upsert(ghost),
      onState: (open) => this.#setLiveState(open),
    });
  }

  start(): void {
    if (this.#seed) this.#live.subscribe(this.#seed);
  }

  setSeed(seed: string): void {
    if (seed === this.#seed) return;
    this.#seed = seed;
    this.#clear();
    this.#live.subscribe(seed);
    // The socket answers a subscribe with the full list, so only poll if it
    // isn't there to answer.
    if (!this.#liveOpen) void this.#refresh();
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#live.dispose();
    this.#clear();
  }

  #setLiveState(open: boolean): void {
    this.#liveOpen = open;
    if (open) {
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = undefined;
    } else if (!this.#timer) {
      void this.#refresh();
    }
  }

  #clear(): void {
    for (const entry of this.#entries.values()) this.#removeEntry(entry);
    this.#entries.clear();
    this.#notify();
  }

  /**
   * Hands the leaderboard the current set. Unordered on purpose: ranking is a
   * presentation decision and `standings()` in leaderboard.ts owns it, so
   * there is exactly one definition of what beats what.
   */
  #notify(): void {
    if (!this.#onChange) return;
    this.#onChange([...this.#entries.values()].map((e) => e.ghost));
  }

  #removeEntry(entry: GhostEntry): void {
    this.#scene.remove(entry.mesh);
    disposeCarModel(entry.mesh);
    entry.label.remove();
  }

  async #refresh(): Promise<void> {
    const seed = this.#seed;
    try {
      const ghosts = await getGhosts(seed);
      // Discard the result if the socket came up while this was in flight:
      // it is now the fresher source, and a stale full list would delete a
      // ghost that arrived over the socket in the meantime.
      if (seed === this.#seed && !this.#liveOpen) this.#render(ghosts);
    } catch {
      // Offline or a transient error — the overlay just stays as it was
      // until the next poll; not worth surfacing to the player.
    } finally {
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = this.#liveOpen
        ? undefined
        : setTimeout(() => void this.#refresh(), POLL_MIN_MS + Math.random() * POLL_JITTER_MS);
    }
  }

  /** Moves one ghost into place, creating its mesh and label on first sight. */
  #upsert(ghost: Ghost, notify = true): void {
    let entry = this.#entries.get(ghost.username);
    if (!entry) entry = this.#createEntry(ghost.username);
    entry.ghost = ghost;
    // `lane` is stored as a lateral offset in metres, so runs recorded before
    // ADR 0004 hold a continuous value. Snapping puts them in a lane instead
    // of between two, at the cost of up to 1.2m of lateral approximation —
    // their distance, which is the actual score, is exact.
    entry.mesh.position.x = laneX(snapToLane(ghost.lane ?? 0));
    entry.mesh.position.z = -ghost.distance;
    if (notify) this.#notify();
  }

  /** Replaces the whole set — the answer to a subscribe, or to a poll. */
  #render(ghosts: Ghost[]): void {
    const seen = new Set<string>();
    for (const ghost of ghosts) {
      seen.add(ghost.username);
      this.#upsert(ghost, false); // one notify for the whole batch, below
    }
    for (const [username, entry] of this.#entries) {
      if (!seen.has(username)) {
        this.#removeEntry(entry);
        this.#entries.delete(username);
      }
    }
    this.#notify();
  }

  #createEntry(username: string): GhostEntry {
    const h = hashString(username);
    // ±0.04 around lavender's own hue — distinct without drifting into a
    // different named colour.
    const hueOffset = ((h % 1000) / 1000 - 0.5) * 0.08;
    const color = new THREE.Color().setHSL(lavenderHsl.h + hueOffset, Math.min(1, lavenderHsl.s + 0.1), lavenderHsl.l);
    const mesh = createGhostCar(color);
    mesh.position.y = 0.5;
    this.#scene.add(mesh);

    const label = document.createElement("div");
    label.className = "ghost-label";
    label.textContent = username;
    label.hidden = true;
    this.#labelContainer.appendChild(label);

    const entry: GhostEntry = {
      mesh,
      label,
      phase: (h % 628) / 100,
      ghost: { username, distance: 0, lane: null }, // replaced by the caller
    };
    this.#entries.set(username, entry);
    return entry;
  }

  /** Bobs each ghost gently and projects its name tag onto the HUD. Call once per frame. */
  update(dt: number, camera: THREE.Camera, viewWidth: number, viewHeight: number): void {
    this.#clock += dt;
    const projected = new THREE.Vector3();
    for (const entry of this.#entries.values()) {
      entry.mesh.position.y = 0.5 + Math.sin(this.#clock * BOB_SPEED + entry.phase) * BOB_HEIGHT;

      projected.copy(entry.mesh.position);
      projected.y += 1.3;
      projected.project(camera);
      const behind = projected.z > 1;
      if (behind || projected.x < -1.15 || projected.x > 1.15 || projected.y < -1.15 || projected.y > 1.15) {
        entry.label.hidden = true;
        continue;
      }
      entry.label.hidden = false;
      const sx = ((projected.x * 0.5 + 0.5) * viewWidth).toFixed(1);
      const sy = ((1 - (projected.y * 0.5 + 0.5)) * viewHeight).toFixed(1);
      entry.label.style.transform = `translate(${sx}px, ${sy}px)`;
    }
  }

  /**
   * How strongly a ghost is being passed right now: 0 with none in range,
   * rising to 1 at the moment of overlap. Audio reads this to swell the
   * ghost pad — proximity, not a trigger, because the swell has to peak on
   * the overlap rather than start there.
   */
  nearness(distance: number, offset: number): number {
    let best = 0;
    for (const entry of this.#entries.values()) {
      const ahead = 1 - Math.min(1, Math.abs(entry.ghost.distance - distance) / NEARNESS_RANGE);
      if (ahead <= best) continue;
      // A ghost in the next lane still registers, but softly — you drove past
      // it, not through it.
      const lateral = Math.abs(laneX(snapToLane(entry.ghost.lane ?? 0)) - offset);
      best = Math.max(best, ahead * (1 - 0.6 * Math.min(1, lateral / (2 * LANE_WIDTH))));
    }
    return best;
  }
}
