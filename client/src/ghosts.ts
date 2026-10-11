// Translucent cars at other players' best-of-the-day crash points — the
// single most important object in the scene (see plan.md: "the ghost is the
// single most important object on screen"). Synced by polling, not push — a
// few minutes' staleness is fine for this (see doc/adr/0001-stack.md);
// `scoreChanged()` server-side is the seam for a future broadcast, not this
// file.
//
// Each ghost gets its own material (a small hue variance around lavender,
// seeded from the username) rather than sharing one, so a row of ghosts
// reads as distinct presences rather than identical clones, plus a name
// label projected into screen space every frame. No collision against
// them — they were never solid, and that's deliberate: insubstantial,
// something you drive past, not an obstacle.
import * as THREE from "three";
import { hashString, laneX, snapToLane } from "./track.ts";
import { getGhosts } from "./net.ts";
import type { Ghost } from "./net.ts";
import { palette } from "./palette.ts";

const POLL_MIN_MS = 60_000;
const POLL_JITTER_MS = 60_000;
const BOB_HEIGHT = 0.08;
const BOB_SPEED = 1.4;

const ghostGeometry = new THREE.BoxGeometry(1.2, 1, 2.2);
const lavenderHsl = new THREE.Color(palette.lavender.three).getHSL({ h: 0, s: 0, l: 0 });

interface GhostEntry {
  mesh: THREE.Mesh;
  label: HTMLDivElement;
  phase: number;
}

export class GhostLayer {
  #scene: THREE.Scene;
  #labelContainer: HTMLElement;
  #entries = new Map<string, GhostEntry>();
  #seed: string;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #clock = 0;

  constructor(scene: THREE.Scene, seed: string, labelContainer: HTMLElement) {
    this.#scene = scene;
    this.#seed = seed;
    this.#labelContainer = labelContainer;
  }

  start(): void {
    void this.#refresh();
  }

  setSeed(seed: string): void {
    if (seed === this.#seed) return;
    this.#seed = seed;
    this.#clear();
    void this.#refresh();
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#clear();
  }

  #clear(): void {
    for (const entry of this.#entries.values()) this.#removeEntry(entry);
    this.#entries.clear();
  }

  #removeEntry(entry: GhostEntry): void {
    this.#scene.remove(entry.mesh);
    (entry.mesh.material as THREE.Material).dispose();
    entry.label.remove();
  }

  async #refresh(): Promise<void> {
    const seed = this.#seed;
    try {
      const ghosts = await getGhosts(seed);
      if (seed === this.#seed) this.#render(ghosts);
    } catch {
      // Offline or a transient error — the overlay just stays as it was
      // until the next poll; not worth surfacing to the player.
    } finally {
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.#refresh(), POLL_MIN_MS + Math.random() * POLL_JITTER_MS);
    }
  }

  #render(ghosts: Ghost[]): void {
    const seen = new Set<string>();
    for (const ghost of ghosts) {
      seen.add(ghost.username);
      let entry = this.#entries.get(ghost.username);
      if (!entry) entry = this.#createEntry(ghost.username);
      // `lane` is stored as a lateral offset in metres, so runs recorded
      // before ADR 0004 hold a continuous value. Snapping puts them in a lane
      // instead of between two, at the cost of up to 1.2m of lateral
      // approximation — their distance, which is the actual score, is exact.
      entry.mesh.position.x = laneX(snapToLane(ghost.lane ?? 0));
      entry.mesh.position.z = -ghost.distance;
    }
    for (const [username, entry] of this.#entries) {
      if (!seen.has(username)) {
        this.#removeEntry(entry);
        this.#entries.delete(username);
      }
    }
  }

  #createEntry(username: string): GhostEntry {
    const h = hashString(username);
    // ±0.04 around lavender's own hue — distinct without drifting into a
    // different named colour.
    const hueOffset = ((h % 1000) / 1000 - 0.5) * 0.08;
    const color = new THREE.Color().setHSL(lavenderHsl.h + hueOffset, Math.min(1, lavenderHsl.s + 0.1), lavenderHsl.l);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.1,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(ghostGeometry, material);
    mesh.position.y = 0.5;
    this.#scene.add(mesh);

    const label = document.createElement("div");
    label.className = "ghost-label";
    label.textContent = username;
    label.hidden = true;
    this.#labelContainer.appendChild(label);

    const entry: GhostEntry = { mesh, label, phase: (h % 628) / 100 };
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
}
