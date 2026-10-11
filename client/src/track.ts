// Deterministic track generation: every client with the same `seed` (a UTC
// date, e.g. "2026-10-06") reconstructs an identical road, so a ghost at a
// given distance sits on a real spot you're actually driving past — not a
// coincidence, it's the whole mechanic. See doc/adr/0002-daily-seeded-archive.md.
//
// The road is three discrete lanes on a straight centerline, and obstacles
// come from a seeded sequence of hand-written gate patterns rather than
// per-chunk random placement — see doc/adr/0004-discrete-three-lane-runner.md
// for why, and for the solvability guarantee `patternIsSolvable` enforces.
export const CHUNK_LENGTH = 20;
export const ROAD_HALF_WIDTH = 4;

/** Lane centres sit at -LANE_WIDTH, 0, +LANE_WIDTH. */
export const LANE_WIDTH = 2.4;
export const LANE_HALF_WIDTH = LANE_WIDTH / 2;

export type Lane = -1 | 0 | 1;
export const LANES: readonly Lane[] = [-1, 0, 1];

/** Lateral world position of a lane index. */
export function laneX(lane: number): number {
  return lane * LANE_WIDTH;
}

/**
 * Nearest lane to a continuous lateral offset in metres. Used for ghosts
 * recorded before ADR 0004, whose stored `lane` is an offset rather than an
 * index — see that record's consequences for what the rounding costs.
 */
export function snapToLane(offsetMetres: number): Lane {
  const i = Math.round(offsetMetres / LANE_WIDTH);
  return (i < -1 ? -1 : i > 1 ? 1 : i) as Lane;
}

// A tiny seeded PRNG (mulberry32) and a string hash (FNV-1a) — both small and
// dependency-free, chosen specifically so an agent writes them in a few
// obvious lines rather than pulling in a library for it. Exported (unchanged)
// so the decorative, non-geometry parts of the scene — the seeded wireframe
// mountains in mountains.ts, ghost name-tag tinting in ghosts.ts — can reuse
// the same small PRNG instead of each hand-rolling their own.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- speed ----
// The ramp lives here rather than in car.ts because gate spacing is derived
// from it (see gateSpacingAt), and car.ts already imports this module. Keeping
// it a function of distance alone is what makes obstacle placement a pure
// function of (seed, distance), which ADR 0002 depends on.
const BASE_SPEED = 9; // m/s
const SPEED_GROWTH = 0.9; // extra m/s per sqrt(metre travelled) — gentle ramp
// The ceiling the ramp approaches. The sqrt curve alone is unbounded — it
// passed 100 m/s around 11km, which no reaction window makes fair — so it
// clamps here, reached at ((MAX_SPEED - BASE_SPEED) / SPEED_GROWTH)^2 ≈ 3870m.
// Raised from 45 to 52 after play-testing (the cap arrived early enough that
// the back half of a long run stopped developing), then to 65 for the same
// reason one ramp further out: gate spacing is speed × interval (see
// gateSpacingAt), so a higher ceiling only ever widens gaps, never shrinks the
// reaction window.
const MAX_SPEED = 65;

export function speedAt(distance: number): number {
  // Math.max guards the sqrt: a negative distance returns NaN, and because the
  // caller feeds the result straight back into distance, one NaN poisons the
  // whole run. Belt and braces with main.ts's dt clamp — this function is also
  // called by gateSpacingAt during generation, where a NaN would be far less
  // obvious than a frozen score.
  return Math.min(MAX_SPEED, BASE_SPEED + SPEED_GROWTH * Math.sqrt(Math.max(0, distance)));
}

// ---- gate patterns ----
// A row names the lanes it BLOCKS. One or two, never three: a row that
// blocked all three would be unpassable by construction.
export type Row = readonly Lane[];

export interface Pattern {
  readonly name: string;
  readonly rows: readonly Row[];
}

export const PATTERNS: readonly Pattern[] = [
  { name: "single-left", rows: [[-1]] },
  { name: "single-centre", rows: [[0]] },
  { name: "single-right", rows: [[1]] },
  { name: "clamp-outer", rows: [[-1, 1]] },
  { name: "clamp-left", rows: [[-1, 0]] },
  { name: "clamp-right", rows: [[0, 1]] },
  { name: "slalom-lr", rows: [[-1], [1]] },
  { name: "slalom-rl", rows: [[1], [-1]] },
  { name: "weave-centre", rows: [[0], [-1], [0], [1]] },
  { name: "zigzag-down", rows: [[-1], [0], [1]] },
  { name: "zigzag-up", rows: [[1], [0], [-1]] },
  { name: "corridor-centre", rows: [[-1, 1], [-1, 1]] },
  { name: "corridor-right", rows: [[-1, 0], [-1, 0]] },
  { name: "corridor-left", rows: [[0, 1], [0, 1]] },
  { name: "gate-then-left", rows: [[0, 1], [-1]] },
  { name: "gate-then-right", rows: [[-1, 0], [1]] },
  { name: "double-tap-left", rows: [[1], [0, 1]] },
  { name: "double-tap-right", rows: [[-1], [-1, 0]] },
  { name: "centre-gate", rows: [[-1, 1], [0]] },
  { name: "long-weave", rows: [[-1], [1], [-1], [1]] },
];

/** Lanes reachable from `lanes` after one row of travel (one shift at most). */
function neighbours(lanes: readonly Lane[]): Lane[] {
  const out = new Set<Lane>();
  for (const lane of lanes) {
    for (const d of [-1, 0, 1]) {
      const n = lane + d;
      if (n >= -1 && n <= 1) out.add(n as Lane);
    }
  }
  return [...out];
}

/**
 * True when a player entering from any lane can get through every row of
 * `pattern`, assuming at most one lane shift between consecutive rows.
 * This is the invariant ADR 0004 asserts rather than hopes for; two patterns
 * in the first draft of the catalogue failed it and were replaced.
 */
export function patternIsSolvable(pattern: Pattern): boolean {
  let reachable: Lane[] = [...LANES];
  for (const row of pattern.rows) {
    if (row.length >= LANES.length) return false;
    const blocked = new Set<Lane>(row);
    reachable = neighbours(reachable).filter((lane) => !blocked.has(lane));
    if (reachable.length === 0) return false;
  }
  return true;
}

// ---- the seeded playlist ----
// Two empty rows after each pattern. That rest is what lets solvability be
// checked one pattern at a time: from any single lane, two free rows reach
// all three lanes, so every pattern can assume it starts wide open.
const REST_ROWS = 2;
const EMPTY: Row = [];

const playlistCache = new Map<string, Row[]>();

function playlistFor(seed: string): Row[] {
  let playlist = playlistCache.get(seed);
  if (playlist) return playlist;

  const order = [...PATTERNS];
  const rng = mulberry32(hashString(`${seed}:patterns`));
  // Fisher-Yates, seeded — the same day deals the same catalogue order to
  // every client.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  playlist = [];
  for (const pattern of order) {
    playlist.push(...pattern.rows);
    for (let i = 0; i < REST_ROWS; i++) playlist.push(EMPTY);
  }
  playlistCache.set(seed, playlist);
  return playlist;
}

// ---- row placement ----
// No obstacles before this, so a run always has a clear start.
const START_DISTANCE = 70;
const GATE_INTERVAL_START = 0.85; // seconds between gates at the start of a run
const GATE_INTERVAL_MIN = 0.36; // the reaction-window floor it tightens toward
const GATE_INTERVAL_FALLOFF = 900; // metres over which it closes most of that gap

/**
 * Metres to the next gate. Spacing is `speed × interval`: speed rises and the
 * interval tightens, so gates get closer in TIME but further apart in SPACE —
 * which is what keeps a fair reaction window at the top of the ramp.
 */
function gateSpacingAt(distance: number): number {
  const t = 1 - Math.exp(-distance / GATE_INTERVAL_FALLOFF);
  const interval = GATE_INTERVAL_START - (GATE_INTERVAL_START - GATE_INTERVAL_MIN) * t;
  return speedAt(distance) * interval;
}

interface ObstacleRow {
  distance: number;
  blocked: Row;
}

// Row N's position depends on rows 0..N-1, so it's a cumulative scan cached
// per seed — the same shape as the centerline cache this replaces.
const rowCache = new Map<string, ObstacleRow[]>();

function rowsThrough(seed: string, distance: number): ObstacleRow[] {
  let rows = rowCache.get(seed);
  if (!rows) {
    rows = [];
    rowCache.set(seed, rows);
  }
  const playlist = playlistFor(seed);
  while (rows.length === 0 || rows[rows.length - 1]!.distance <= distance) {
    const i = rows.length;
    const at = i === 0 ? START_DISTANCE : rows[i - 1]!.distance + gateSpacingAt(rows[i - 1]!.distance);
    rows.push({ distance: at, blocked: playlist[i % playlist.length]! });
  }
  return rows;
}

export interface Obstacle {
  lane: Lane;
  x: number;
  z: number;
}

export interface Chunk {
  index: number;
  obstacles: Obstacle[];
}

export function chunkFor(seed: string, index: number): Chunk {
  const start = index * CHUNK_LENGTH;
  const end = start + CHUNK_LENGTH;
  const obstacles: Obstacle[] = [];
  for (const row of rowsThrough(seed, end)) {
    if (row.distance < start || row.distance >= end) continue;
    for (const lane of row.blocked) {
      obstacles.push({ lane, x: laneX(lane), z: -row.distance });
    }
  }
  return { index, obstacles };
}
