// Translucent cars at other players' best-of-the-day crash points. Synced by
// polling, not push — a few minutes' staleness is fine for this (see
// doc/adr/0001-stack.md); `scoreChanged()` server-side is the seam for a
// future broadcast, not this file.
import * as THREE from "three";
import { centerXAtDistance } from "./track.ts";
import { getGhosts } from "./net.ts";
import type { Ghost } from "./net.ts";
import { palette } from "./palette.ts";

const POLL_MIN_MS = 60_000;
const POLL_JITTER_MS = 60_000;

// Lavender, not the player's magenta or the obstacles' red — the one
// deliberately vaporwave (not synthwave) colour in the scene. Phase 4 gives
// each ghost its own material instance and a name label; this shared one is
// the Phase 1 recolour.
const ghostMaterial = new THREE.MeshStandardMaterial({
  color: palette.lavender.three,
  emissive: palette.lavender.three,
  emissiveIntensity: 1.4,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const ghostGeometry = new THREE.BoxGeometry(1.2, 1, 2.2);

export class GhostLayer {
  #scene: THREE.Scene;
  #meshes = new Map<string, THREE.Mesh>();
  #seed: string;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(scene: THREE.Scene, seed: string) {
    this.#scene = scene;
    this.#seed = seed;
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
    for (const mesh of this.#meshes.values()) this.#scene.remove(mesh);
    this.#meshes.clear();
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
      let mesh = this.#meshes.get(ghost.username);
      if (!mesh) {
        mesh = new THREE.Mesh(ghostGeometry, ghostMaterial);
        this.#meshes.set(ghost.username, mesh);
        this.#scene.add(mesh);
      }
      const x = centerXAtDistance(this.#seed, ghost.distance) + (ghost.lane ?? 0);
      mesh.position.set(x, 0.5, -ghost.distance);
    }
    for (const [username, mesh] of this.#meshes) {
      if (!seen.has(username)) {
        this.#scene.remove(mesh);
        this.#meshes.delete(username);
      }
    }
  }
}
