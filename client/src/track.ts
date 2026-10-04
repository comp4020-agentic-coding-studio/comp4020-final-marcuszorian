// Deterministic track generation: every client with the same `seed` (a UTC
// date, e.g. "2026-10-06") reconstructs an identical road, so a ghost at a
// given distance sits on a real spot you're actually driving past — not a
// coincidence, it's the whole mechanic. See doc/adr/0002-daily-seeded-archive.md.
export const CHUNK_LENGTH = 20;
export const ROAD_HALF_WIDTH = 4;
const CURVE_MAX = 1.4;

// A tiny seeded PRNG (mulberry32) and a string hash (FNV-1a) — both small and
// dependency-free, chosen specifically so an agent writes them in a few
// obvious lines rather than pulling in a library for it.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Obstacle {
  x: number;
  z: number;
}

export interface Chunk {
  index: number;
  centerX: number;
  obstacles: Obstacle[];
}

// Each chunk nudges the road's centerline sideways by a small seeded amount.
// centerXAt is the cumulative sum of those nudges — a pure function of
// (seed, index), cached per seed since chunk N depends on chunks 0..N-1.
const centerCache = new Map<string, number[]>();

function driftFor(seed: string, index: number): number {
  const rng = mulberry32(hashString(`${seed}:drift:${index}`));
  return (rng() - 0.5) * 2 * CURVE_MAX;
}

export function centerXAt(seed: string, index: number): number {
  let cache = centerCache.get(seed);
  if (!cache) {
    cache = [0];
    centerCache.set(seed, cache);
  }
  while (cache.length <= index) {
    const prev = cache[cache.length - 1]!;
    cache.push(prev + driftFor(seed, cache.length - 1));
  }
  return cache[index]!;
}

// Smooth centerline position at an arbitrary forward distance (not just at
// chunk boundaries) — used both to place the car's visual world position and
// to place ghosts at their recorded distance.
export function centerXAtDistance(seed: string, distance: number): number {
  const t = distance / CHUNK_LENGTH;
  const i0 = Math.floor(t);
  const i1 = i0 + 1;
  const c0 = centerXAt(seed, i0);
  const c1 = centerXAt(seed, i1);
  return c0 + (c1 - c0) * (t - i0);
}

export function chunkFor(seed: string, index: number): Chunk {
  const centerX = centerXAt(seed, index);
  const rng = mulberry32(hashString(`${seed}:obstacles:${index}`));
  // Ease in: no obstacles in the first few chunks, so a run always has a
  // clear start.
  const obstacleCount = index < 3 ? 0 : Math.floor(rng() * 2);
  const obstacles: Obstacle[] = [];
  for (let i = 0; i < obstacleCount; i++) {
    const x = centerX + (rng() - 0.5) * 2 * (ROAD_HALF_WIDTH - 0.8);
    const z = -(index * CHUNK_LENGTH + rng() * CHUNK_LENGTH);
    obstacles.push({ x, z });
  }
  return { index, centerX, obstacles };
}
