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

/**
 * Metres to the next gate. Spacing is `speed × interval`: speed rises and the
 * interval tightens, so gates get closer in TIME but further apart in SPACE —
 * which is what keeps a fair reaction window at the top of the ramp.
 *
 * `t` tracks `speedAt`'s own progress toward MAX_SPEED (0 at BASE_SPEED, 1 at
 * the cap) rather than a separate distance falloff of its own: two
 * independently-tuned ramps drifted apart the last time MAX_SPEED moved, with
 * the interval maxing out a third of the way into the speed ramp and
 * difficulty flatlining for the rest of a long run even as the car kept
 * getting faster. Deriving `t` from speed means raising the speed ceiling
 * again keeps the two in step without retuning this function too.
 */
function gateSpacingAt(distance: number): number {
  const speed = speedAt(distance);
  const t = (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
  const interval = GATE_INTERVAL_START - (GATE_INTERVAL_START - GATE_INTERVAL_MIN) * t;
  return speed * interval;
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

// Index of the first row at or after `distance`: `lowerBound`, defined below
// once all three row kinds (static barrier, moving barrier, oil) exist, since
// it's shared by all of them rather than redefined per kind.
//
// `chunkFor` used to find its chunk's rows with a plain `for...of` over the
// WHOLE array and skip the ones outside [start, end) — fine for a short run,
// but `rows` only grows for a seed's lifetime in this tab, and `chunkFor` is
// called several times a frame (collision in stepAndStream, lookahead in the
// attract-mode autopilot) for as long as the page is open. Linear time times
// "forever" is a frame that keeps getting slower the longer a session runs —
// measured at ~0.016ms/call near the start of a seed, climbing past
// ~0.06ms/call by 300km of accumulated distance. That distance used to need
// an actual human still playing; attract mode now racks it up on its own
// behind the title screen, so a tab left idle hits the slow end far sooner
// than any real run used to. Binary search makes one chunk's lookup
// O(log rows) instead of O(rows), which stays cheap regardless of how long
// the tab, or the seed's own history, has been running.

// ---- obstacle kinds (doc/adr/0012) ----
// Existing static barriers are `kind: "barrier"` with no behavioural change —
// everything above this point (PATTERNS, patternIsSolvable, the playlist,
// rowsThrough, gateSpacingAt) keeps exactly its current meaning. The two new
// kinds below are additive, parallel mechanisms, not edits to that one.
export type ObstacleKind = "barrier" | "moving-barrier" | "oil" | "ramp";

export interface Obstacle {
  kind: ObstacleKind;
  lane: Lane;
  x: number;
  z: number;
  /** Present only for `kind: "moving-barrier"` — lets a later reader (car.ts's
   * collision loop, main.ts's per-frame reposition) recompute `x` from the
   * car's own live distance instead of trusting the `x` this obstacle was
   * built with, which is only ever correct at `motion.anchor`. */
  motion?: MotionParams;
  /** Present only for `kind: "ramp"` — distance of the single-lane barrier
   * row this ramp is paired with (doc/adr/0014). `main.ts` reads this to
   * exempt that barrier from collision for the trick's duration and to snap
   * the car past it once the trick settles. */
  barrierDistance?: number;
}

export interface Chunk {
  index: number;
  obstacles: Obstacle[];
}

// ---- moving barriers ----
// Obstacle 01 in the concept art: a barricade on slider rails that sweeps
// laterally across lanes. Fatal on contact exactly like a static barrier —
// only how its `x` is computed differs.
//
// Its lane position is a pure function of the car's own `distance`, never
// wall-clock time (ADR 0012): two clients on the same seed, asking for the
// same obstacle at the same distance, must get the same answer, or a ghost
// would drift off a barrier the original run dodged (ADR 0002).
export interface MotionParams {
  /** Distance at which the sweep sits exactly on `center` (phase 0). */
  readonly anchor: number;
  /** Metres either side of `center` the sweep swings. */
  readonly amplitude: number;
  /** Metres of travel per full sweep cycle. */
  readonly wavelength: number;
  /** Radians, offsets one barrier's sweep from another's at the same row. */
  readonly phase: number;
}

/**
 * Lateral position of a moving barrier at `distance`. The one formula ADR
 * 0012 fixes — exported so car.ts's collision loop and main.ts's per-frame
 * mesh reposition both call this instead of each re-deriving it.
 */
export function movingBarrierX(centerLane: Lane, motion: MotionParams, distance: number): number {
  const theta = (2 * Math.PI * (distance - motion.anchor)) / motion.wavelength + motion.phase;
  return laneX(centerLane) + motion.amplitude * Math.sin(theta);
}

export interface MovingBarrierSpec {
  readonly center: Lane;
  readonly amplitude: number;
  readonly wavelength: number;
  readonly phase: number;
}

/** One or more moving barriers active at the same row — a solo sweep, or a
 * phase-offset pair/trio sweeping together. Empty for a rest row. */
export type MovingRow = readonly MovingBarrierSpec[];

export interface MovingPattern {
  readonly name: string;
  readonly rows: readonly MovingRow[];
}

// All specs stay centred on lane 0: amplitude == LANE_WIDTH already swings a
// full lane either side (x in [-LANE_WIDTH, +LANE_WIDTH]), covering all three
// lanes without ever swinging a centre-±1 sweep off the road.
// Lateral speed in time is amplitude * (2π·carSpeed / wavelength) — doubling
// wavelength halves how fast the sweep reads at any given approach speed,
// without touching `(seed, distance)` purity (ADR 0012).
const SWEEP_WAVELENGTH = 36; // metres of travel per full lateral cycle
const SWEEP_AMPLITUDE = LANE_WIDTH;

// No row may carry two specs centred on the same lane — two barriers
// crossing back and forth through the same slot read as one barrier
// glitching, not two obstacles, and doubling up there was never actually
// giving a player two things to dodge (both specs occupy or vacate the lane
// together half the time). A second barrier bound to a lane instead comes
// *after* the first one, a plain row further down the playlist — "behind it,"
// never "on it at the same time." `movingPatternIsSolvable` below asserts
// this the same way it already asserts a shared wavelength.
export const MOVING_PATTERNS: readonly MovingPattern[] = [
  {
    name: "solo-sweep",
    rows: [[{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: 0 }]],
  },
  {
    name: "solo-sweep-offset",
    rows: [[{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: Math.PI }]],
  },
  // Two solo sweeps back to back — the moving equivalent of a slalom. Same
  // lane, but staggered in distance: never both sweeping that lane at once.
  {
    name: "sweep-train",
    rows: [
      [{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: 0 }],
      [{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: Math.PI }],
    ],
  },
  // Three in a row — the long version of the same idea.
  {
    name: "sweep-train-long",
    rows: [
      [{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: 0 }],
      [{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: Math.PI }],
      [{ center: 0, amplitude: SWEEP_AMPLITUDE, wavelength: SWEEP_WAVELENGTH, phase: 0 }],
    ],
  },
];

const SWEEP_SOLVABILITY_SAMPLES = 64;

/** Lanes a moving row occupies at a given point in its cycle, using the same
 * collision half-width car.ts's fatal-collision test uses for a static
 * barrier — "occupied" means "would hit", nothing looser. */
function occupiedLanesAt(row: MovingRow, phaseDistance: number): Set<Lane> {
  const occupied = new Set<Lane>();
  for (const spec of row) {
    const motion: MotionParams = { anchor: 0, amplitude: spec.amplitude, wavelength: spec.wavelength, phase: spec.phase };
    const x = movingBarrierX(spec.center, motion, phaseDistance);
    for (const lane of LANES) {
      if (Math.abs(x - laneX(lane)) < LANE_HALF_WIDTH) occupied.add(lane);
    }
  }
  return occupied;
}

/**
 * The continuous analogue of `patternIsSolvable`. `sin` is periodic, so
 * sampling one full wavelength of travel covers every phase a row can ever be
 * caught at — this asserts a lane is free at every one of those samples.
 * Every spec in a row must share a wavelength, or "one period" isn't a
 * well-defined thing to sample; that's asserted rather than left to
 * convention, since a future pattern could easily get it wrong by hand.
 */
export function movingPatternIsSolvable(pattern: MovingPattern): boolean {
  for (const row of pattern.rows) {
    if (row.length === 0) continue;
    const lanes = new Set(row.map((spec) => spec.center));
    if (lanes.size !== row.length) {
      // Two barriers bound to the same lane at once is never two things to
      // dodge — only ever a second barrier reads as "give the player more to
      // navigate," and that's a later row (behind it), not the same one.
      throw new Error(`${pattern.name}: a row may not put two moving barriers on the same lane`);
    }
    const wavelength = row[0]!.wavelength;
    if (row.some((spec) => spec.wavelength !== wavelength)) {
      throw new Error(`${pattern.name}: every spec in a row must share one wavelength to sample one period`);
    }
    for (let i = 0; i < SWEEP_SOLVABILITY_SAMPLES; i++) {
      const distance = (i / SWEEP_SOLVABILITY_SAMPLES) * wavelength;
      const occupied = occupiedLanesAt(row, distance);
      if (LANES.every((lane) => occupied.has(lane))) return false;
    }
  }
  return true;
}

// Dealt the same way PATTERNS is (seeded shuffle + rest rows), but as its own
// playlist/timeline — a parallel mechanism, not a row type static barriers
// also use, so adding it can't perturb a single static-barrier distance.
const movingPlaylistCache = new Map<string, MovingRow[]>();

function movingPlaylistFor(seed: string): MovingRow[] {
  let playlist = movingPlaylistCache.get(seed);
  if (playlist) return playlist;

  const order = [...MOVING_PATTERNS];
  const rng = mulberry32(hashString(`${seed}:moving-patterns`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  playlist = [];
  for (const pattern of order) {
    playlist.push(...pattern.rows);
    for (let i = 0; i < REST_ROWS; i++) playlist.push(EMPTY_MOVING_ROW);
  }
  movingPlaylistCache.set(seed, playlist);
  return playlist;
}

const EMPTY_MOVING_ROW: MovingRow = [];
// First moving barrier arrives after the player's had a few plain barriers to
// learn the road on. Spaced further apart than static gates (MOVING_SPACING)
// since a continuous sweep takes longer to read than an instantaneous row.
const MOVING_START_DISTANCE = START_DISTANCE + 140;
const MOVING_SPACING_FACTOR = 1.6;
// A moving barrier's sweep crosses every lane over its cycle (SWEEP_AMPLITUDE
// already spans a full lane either side of its lane-0 centre), so it must
// never land near a static-barrier row at all — not "the same lane," any
// lane — or the two can box the player into whatever single lane the static
// row left open, only for the sweep to close that lane too moments later (a
// real case hit in play: a `clamp-outer` row leaves only lane 0 open, and a
// lane-0 sweep anchored nearby sweeps that last lane shut). One
// CHUNK_LENGTH of clearance either side is enough room to read the two as
// separate hazards rather than one obstacle glitching into another.
const MOVING_LANE_CLEARANCE = CHUNK_LENGTH;

/** Whether any static-barrier row, blocking any lane, falls within
 * `MOVING_LANE_CLEARANCE` of `distance` — checked before a moving-barrier row
 * is placed there, same direction of dependency `oilThrough` already has on
 * static barriers (moving defers to static, never the reverse). Deliberately
 * blind to which lane(s) the row blocks: a moving sweep must never land near
 * ANY static row, since the sweep crosses every lane over its cycle and a
 * static row can leave only one lane open for the sweep to later close (see
 * `MOVING_LANE_CLEARANCE`'s comment). */
function staticBarrierNear(seed: string, distance: number): boolean {
  const rows = rowsThrough(seed, distance + MOVING_LANE_CLEARANCE);
  const start = lowerBound(rows, distance - MOVING_LANE_CLEARANCE);
  for (let i = start; i < rows.length && rows[i]!.distance <= distance + MOVING_LANE_CLEARANCE; i++) {
    if (rows[i]!.blocked.length > 0) return true;
  }
  return false;
}

/** Whether any *already-placed* oil spill covering lane 0 falls within
 * `MOVING_LANE_CLEARANCE` of `distance`. Reads `oilCache` directly rather
 * than calling `oilThrough` — oil's own placement already calls
 * `movingRowsThrough` (via `firstFatalDistanceAtOrAfter`), so having this
 * call `oilThrough` back would make the two kinds try to extend each other's
 * timeline indefinitely. A passive read breaks that cycle: moving barriers
 * only ever avoid oil that already exists, never oil that would need
 * generating to check. */
function oilNearLane0(seed: string, distance: number): boolean {
  return oilNearLane(seed, distance, 0);
}

/** `oilNearLane0`, generalised to any lane — a ramp is lane-scoped and can
 * land in any of the three lanes, unlike a moving-barrier row, which only
 * ever centres on lane 0. */
function oilNearLane(seed: string, distance: number, lane: Lane): boolean {
  const spills = oilCache.get(seed);
  if (!spills) return false;
  const start = lowerBound(spills, distance - MOVING_LANE_CLEARANCE);
  for (let i = start; i < spills.length && spills[i]!.distance <= distance + MOVING_LANE_CLEARANCE; i++) {
    if (spills[i]!.lanes.includes(lane)) return true;
  }
  return false;
}

interface MovingObstacleRow {
  distance: number;
  row: MovingRow;
}

const movingRowCache = new Map<string, MovingObstacleRow[]>();

function movingRowsThrough(seed: string, distance: number): MovingObstacleRow[] {
  let rows = movingRowCache.get(seed);
  if (!rows) {
    rows = [];
    movingRowCache.set(seed, rows);
  }
  const playlist = movingPlaylistFor(seed);
  while (rows.length === 0 || rows[rows.length - 1]!.distance <= distance) {
    const i = rows.length;
    let at =
      i === 0
        ? MOVING_START_DISTANCE
        : rows[i - 1]!.distance + gateSpacingAt(rows[i - 1]!.distance) * MOVING_SPACING_FACTOR;
    const row = playlist[i % playlist.length]!;
    // A rest row has nothing to collide with — nothing to check. A non-empty
    // row must clear ANY static-barrier row nearby, regardless of which
    // lane(s) that row blocks — see `staticBarrierNear`'s comment for why a
    // lane-by-lane check isn't enough. Pushed forward, never backward, so
    // rows stay sorted ascending the way `lowerBound` requires.
    if (row.length > 0) {
      while (staticBarrierNear(seed, at) || oilNearLane0(seed, at)) {
        at += MOVING_LANE_CLEARANCE;
      }
    }
    rows.push({ distance: at, row });
  }
  return rows;
}

// ---- oil spills ----
// Obstacle 02 in the concept art: a flat, non-fatal splatter. Placed the same
// seeded way as a barrier row — a distance and 1-2 lanes — but it never
// removes a route, so `patternIsSolvable` has nothing to prove about it. What
// takes its place is narrower: oil can't sit so close to the next fatal
// hazard (static or moving) that a forced drift has nowhere left to resolve.
export interface OilSpill {
  readonly distance: number;
  readonly lanes: readonly Lane[]; // 1 or 2 lanes, never all 3
}

const OIL_START_DISTANCE = START_DISTANCE + 80;
const OIL_INTERVAL_METRES = 180;
// Metres of clear road oil must leave before the next fatal hazard — enough
// room for a forced drift (OIL_SLIDE_SECONDS, added in car.ts) to resolve
// before the player needs full control back.
const OIL_MIN_LEAD_TO_HAZARD = 40;

function pickOilLanes(rng: () => number): Lane[] {
  const a = Math.floor(rng() * LANES.length);
  if (rng() < 0.5) return [LANES[a]!];
  let b = Math.floor(rng() * (LANES.length - 1));
  if (b >= a) b++;
  return [LANES[a]!, LANES[b]!];
}

/** First distance at or after `distance` where a fatal hazard (a blocking
 * static-barrier row, or a non-empty moving-barrier row) sits — oil placement
 * needs this to keep its minimum lead on whatever can actually end the run. */
function firstFatalDistanceAtOrAfter(seed: string, distance: number): number {
  let barrierRows = rowsThrough(seed, distance);
  let bi = lowerBound(barrierRows, distance);
  while (bi >= barrierRows.length || barrierRows[bi]!.blocked.length === 0) {
    if (bi >= barrierRows.length) {
      barrierRows = rowsThrough(seed, barrierRows[barrierRows.length - 1]!.distance + 1);
    } else {
      bi++;
    }
  }

  let movingRows = movingRowsThrough(seed, distance);
  let mi = lowerBound(movingRows, distance);
  while (mi >= movingRows.length || movingRows[mi]!.row.length === 0) {
    if (mi >= movingRows.length) {
      movingRows = movingRowsThrough(seed, movingRows[movingRows.length - 1]!.distance + 1);
    } else {
      mi++;
    }
  }

  return Math.min(barrierRows[bi]!.distance, movingRows[mi]!.distance);
}

/**
 * Oil's target distance: pulled back from `candidate` toward `earliest` to
 * sit `OIL_MIN_LEAD_TO_HAZARD` before the next fatal hazard, whenever that
 * hazard is closer than the interval would otherwise place it.
 * `firstFatalDistanceAtOrAfter(seed, candidate)` alone isn't enough to find
 * that hazard — it only searches from `candidate` onward, so a hazard sitting
 * between `earliest` and `candidate` (which the pullback can land right next
 * to) was never checked.
 *
 * `lo` is both the search floor and the clamp floor, and both advance
 * together: if the hazard found from `lo` is itself too close to `lo` to
 * leave room *before* it, oil can't land there, so `lo` steps all the way to
 * `OIL_MIN_LEAD_TO_HAZARD` past that hazard (not just past it) before the
 * search repeats — anything less leaves oil with no trailing clearance either,
 * i.e. landing right after the very hazard it just stepped around.
 */
function oilDistanceFor(seed: string, earliest: number, candidate: number): number {
  return distanceWithLeadToHazard(seed, earliest, candidate, OIL_MIN_LEAD_TO_HAZARD);
}

/** Last distance at or before `distance` where a fatal hazard sits — the
 * backward counterpart to `firstFatalDistanceAtOrAfter`, used to keep a ramp
 * from spawning right out of the footprint of the hazard it's leading away
 * from. */
function lastFatalDistanceAtOrBefore(seed: string, distance: number): number {
  const barrierRows = rowsThrough(seed, distance);
  let bi = lowerBound(barrierRows, distance) - 1;
  while (bi >= 0 && barrierRows[bi]!.blocked.length === 0) bi--;
  const barrierDistance = bi >= 0 ? barrierRows[bi]!.distance : -Infinity;

  const movingRows = movingRowsThrough(seed, distance);
  let mi = lowerBound(movingRows, distance) - 1;
  while (mi >= 0 && movingRows[mi]!.row.length === 0) mi--;
  const movingDistance = mi >= 0 ? movingRows[mi]!.distance : -Infinity;

  return Math.max(barrierDistance, movingDistance);
}

/**
 * Pulls a candidate distance back toward `earliest` so at least `minLead`
 * metres of clear road sit before the next fatal hazard, whenever that
 * hazard is closer than `candidate` would otherwise place it. Oil-specific:
 * oil wants to land AT `candidate` whenever the road allows it (its usual
 * placement interval), only retreating when a hazard crowds that spot. A
 * ramp wants the opposite — to hug the hazard ahead rather than sit
 * arbitrarily early — so it uses its own search, `rampSpotFor`, below.
 */
function distanceWithLeadToHazard(seed: string, earliest: number, candidate: number, minLead: number): number {
  let lo = earliest;
  for (;;) {
    const hazard = firstFatalDistanceAtOrAfter(seed, lo);
    if (hazard - lo >= minLead) {
      return Math.max(lo, Math.min(candidate, hazard - minLead));
    }
    lo = hazard + minLead;
  }
}

/** Whether an *already-placed* moving-barrier row centred on lane 0 falls
 * within `MOVING_LANE_CLEARANCE` of `distance`. Reads `movingRowCache`
 * directly rather than calling `movingRowsThrough` — by the time oil is
 * placed this far, `oilDistanceFor`'s own hazard search has already forced
 * `movingRowsThrough` to generate everything up to roughly this distance (it
 * calls that inside `firstFatalDistanceAtOrAfter`), so a passive read here
 * sees real data rather than an empty cache. `OIL_MIN_LEAD_TO_HAZARD` already
 * keeps oil clear of whatever hazard comes *after* it; this is the missing
 * other direction — oil landing just *behind* a moving barrier it shares a
 * lane with, which that forward-only check never catches. */
function movingBarrierNearLane0(seed: string, distance: number): boolean {
  return movingBarrierNearLane(seed, distance, 0);
}

/** `movingBarrierNearLane0`, generalised to any lane — see `oilNearLane`. */
function movingBarrierNearLane(seed: string, distance: number, lane: Lane): boolean {
  const rows = movingRowCache.get(seed);
  if (!rows) return false;
  const start = lowerBound(rows, distance - MOVING_LANE_CLEARANCE);
  for (let i = start; i < rows.length && rows[i]!.distance <= distance + MOVING_LANE_CLEARANCE; i++) {
    if (rows[i]!.row.some((spec) => spec.center === lane)) return true;
  }
  return false;
}

const oilCache = new Map<string, OilSpill[]>();

function oilThrough(seed: string, distance: number): OilSpill[] {
  let spills = oilCache.get(seed);
  if (!spills) {
    spills = [];
    oilCache.set(seed, spills);
  }
  while (spills.length === 0 || spills[spills.length - 1]!.distance <= distance) {
    const i = spills.length;
    let earliest = i === 0 ? OIL_START_DISTANCE : spills[i - 1]!.distance + 1;
    const candidate = i === 0 ? OIL_START_DISTANCE : spills[i - 1]!.distance + OIL_INTERVAL_METRES;
    const lanes = pickOilLanes(mulberry32(hashString(`${seed}:oil-lane:${i}`)));
    // Only matters when lane 0 is one of the lanes this spill actually
    // covers — same "lane 0 is the only lane that can collide" reasoning
    // `movingRowsThrough`'s own check above uses. Pushed forward, never
    // backward, same shape as every other clearance loop in this file.
    let at = oilDistanceFor(seed, earliest, candidate);
    while (lanes.includes(0) && movingBarrierNearLane0(seed, at)) {
      earliest = at + MOVING_LANE_CLEARANCE;
      at = oilDistanceFor(seed, earliest, Math.max(candidate, earliest));
    }
    // Oil and ramps are both lane-scoped, non-fatal hazards (doc/adr/0012,
    // doc/adr/0013) — stacking one on the other would read as one obstacle
    // glitching into another, the same reason moving barriers avoid oil above.
    while (lanes.some((lane) => rampNearLane(seed, at, lane))) {
      earliest = at + MOVING_LANE_CLEARANCE;
      at = oilDistanceFor(seed, earliest, Math.max(candidate, earliest));
    }
    spills.push({ distance: at, lanes });
  }
  return spills;
}

// ---- trick ramps ----
// Asset 03 in the concept art: a non-fatal launch ramp that starts a
// quick-time-event trick sequence on contact instead of a crash (doc/adr/
// 0013) — oil's precedent that "contact is not automatically a crash." Each
// ramp is paired with one specific single-lane static-barrier row — the one
// it "jumps" — rather than merely guaranteeing clear road before whatever
// fatal hazard happens to come next (doc/adr/0014, superseding that part of
// 0013). The ramp's lane is the paired barrier's lane, not independently
// seeded.
export interface Ramp {
  readonly distance: number;
  readonly lane: Lane;
  /** Distance of the single-lane barrier row this ramp jumps — `car.ts`
   * exempts that exact row from collision for the trick's duration, and
   * `main.ts` snaps the car to just past it once the trick settles, win or
   * lose (doc/adr/0014). */
  readonly barrierDistance: number;
}

const RAMP_START_DISTANCE = START_DISTANCE + 120;
const RAMP_INTERVAL_METRES = 220;
// How far before its paired barrier a ramp sits — enough road for the
// camera-zoom/slow-mo QTE to read as its own moment before the jump, not a
// safety invariant anymore: `car.ts` exempts the paired barrier outright for
// the trick's duration, and the car is snapped past it when the trick
// settles regardless of outcome (doc/adr/0014). Exported so a generator-level
// test can assert ramp placement against this exact number.
export const RAMP_MIN_LEAD_TO_HAZARD = 55;

// Metres a ramp must sit clear of the fatal hazard immediately BEHIND it —
// purely a visual floor. Without this a ramp can spawn right out of the
// barrier the player just dodged, which reads as a glitch rather than its own
// moment. The "jump over a hazard" feel instead comes from hugging the paired
// barrier AHEAD (see `rampSpotFor`) — this constant only guards the other
// direction, and is allowed to lose to `RAMP_PLACEMENT_HAZARD_SCAN_LIMIT`'s
// fallback in a dense stretch of road, since it's cosmetic rather than a
// safety invariant.
const RAMP_MIN_TRAILING_CLEARANCE = 15;

/**
 * First distance at or after `distance` where a single-lane static-barrier
 * row sits, skipping past any other fatal hazard (a 2-lane barrier row, or a
 * moving-barrier row) found first — a ramp can only pair with a row it can
 * actually jump over and still leave the other two lanes crossable the usual
 * way, so a 2-lane row or a moving sweep is not a valid pairing target
 * (doc/adr/0014).
 */
function firstSingleLaneBarrierAtOrAfter(seed: string, distance: number): ObstacleRow {
  let lo = distance;
  for (;;) {
    const hazard = firstFatalDistanceAtOrAfter(seed, lo);
    const rows = rowsThrough(seed, hazard);
    const i = lowerBound(rows, hazard);
    const row = rows[i];
    if (row && row.distance === hazard && row.blocked.length === 1) return row;
    lo = hazard + 1;
  }
}

const rampCache = new Map<string, Ramp[]>();

/** Whether an *already-placed* ramp in `lane` falls within
 * `MOVING_LANE_CLEARANCE` of `distance`. Passive cache read, same shape as
 * `oilNearLane`/`movingBarrierNearLane` — a ramp's own placement loop below
 * already extends `rampCache` forward of whatever it's checking, so by the
 * time a caller outside this file (or oil, above) asks, the relevant window
 * has already been generated. */
function rampNearLane(seed: string, distance: number, lane: Lane): boolean {
  const ramps = rampCache.get(seed);
  if (!ramps) return false;
  const start = lowerBound(ramps, distance - MOVING_LANE_CLEARANCE);
  for (let i = start; i < ramps.length && ramps[i]!.distance <= distance + MOVING_LANE_CLEARANCE; i++) {
    if (ramps[i]!.lane === lane) return true;
  }
  return false;
}

// A bound on how many single-lane barrier rows `rampSpotFor` will reject
// looking for a pairing that satisfies both the leading and trailing
// clearance at once, before giving up on the trailing half and taking the
// first hazard-safe pairing instead. RAMP_MIN_TRAILING_CLEARANCE is purely a
// visual nicety, so it is the one allowed to lose this trade rather than the
// search running away hunting for a combination of gaps that a dense stretch
// of road may never offer.
const RAMP_PLACEMENT_HAZARD_SCAN_LIMIT = 64;

interface RampSpot {
  readonly distance: number;
  readonly lane: Lane;
  readonly barrierDistance: number;
}

/**
 * Where the next ramp lands and which single-lane barrow it pairs with:
 * hugging close to the next single-lane barrier row at or after
 * `floorDistance` — exactly `RAMP_MIN_LEAD_TO_HAZARD` before it — rather than
 * sitting however far before it the road happens to be clear. Landing right
 * at that margin, instead of arbitrarily early, is what makes the ramp read
 * as a jump over the barrier ahead instead of a precaution taken well clear
 * of it (doc/adr/0014).
 *
 * A candidate barrier is rejected (and the search moves to the next
 * single-lane barrier row) whenever hugging it would land before
 * `floorDistance`, or when some other fatal hazard sits between the landing
 * spot and the barrier itself — `firstSingleLaneBarrierAtOrAfter` can return
 * a row with other (multi-lane or moving) hazards skipped on the way to it,
 * and a ramp must have a clean, hazard-free run at the one barrier it's
 * paired with.
 *
 * Each loop iteration either returns or steps `lo` past the barrier row it
 * just rejected, so this always terminates: there are finitely many hazards
 * between any two distances, and once the generated road's speed curve
 * saturates (doc/adr/0002's `speedAt` cap), hazard spacing settles into the
 * same repeating pattern forever, so a pairing that works recurs rather than
 * becoming rarer the further out this searches.
 */
function rampSpotFor(seed: string, floorDistance: number): RampSpot {
  let lo = floorDistance;
  for (let scanned = 0; ; scanned++) {
    const barrierRow = firstSingleLaneBarrierAtOrAfter(seed, lo);
    const lane = barrierRow.blocked[0]!;
    const at = barrierRow.distance - RAMP_MIN_LEAD_TO_HAZARD;
    if (at >= lo && firstFatalDistanceAtOrAfter(seed, at) === barrierRow.distance) {
      const hazardsClear = !(lane === 0 && movingBarrierNearLane(seed, at, lane)) && !oilNearLane(seed, at, lane);
      const trailingClear = at - lastFatalDistanceAtOrBefore(seed, at) >= RAMP_MIN_TRAILING_CLEARANCE;
      if (hazardsClear && (trailingClear || scanned >= RAMP_PLACEMENT_HAZARD_SCAN_LIMIT)) {
        return { distance: at, lane, barrierDistance: barrierRow.distance };
      }
    }
    lo = barrierRow.distance + 1;
  }
}

function rampThrough(seed: string, distance: number): Ramp[] {
  let ramps = rampCache.get(seed);
  if (!ramps) {
    ramps = [];
    rampCache.set(seed, ramps);
  }
  while (ramps.length === 0 || ramps[ramps.length - 1]!.distance <= distance) {
    const i = ramps.length;
    // A hard floor of a full RAMP_INTERVAL_METRES past the previous ramp —
    // not "+1" — so two ramps can never land close together just because
    // `rampSpotFor`'s hazard-hugging happens to be satisfiable again almost
    // immediately.
    const floorDistance = i === 0 ? RAMP_START_DISTANCE : ramps[i - 1]!.distance + RAMP_INTERVAL_METRES;
    const spot = rampSpotFor(seed, floorDistance);
    ramps.push(spot);
  }
  return ramps;
}

/**
 * Index of the first element at or after `distance` in an array of rows
 * sorted ascending by `distance`. Shared by all three row kinds (barrier,
 * moving-barrier, oil) since each is only ever appended in increasing order.
 */
function lowerBound(rows: readonly { distance: number }[], distance: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rows[mid]!.distance < distance) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function chunkFor(seed: string, index: number): Chunk {
  const start = index * CHUNK_LENGTH;
  const end = start + CHUNK_LENGTH;
  const obstacles: Obstacle[] = [];

  const rows = rowsThrough(seed, end);
  for (let i = lowerBound(rows, start); i < rows.length && rows[i]!.distance < end; i++) {
    const row = rows[i]!;
    for (const lane of row.blocked) {
      obstacles.push({ kind: "barrier", lane, x: laneX(lane), z: -row.distance });
    }
  }

  const movingRows = movingRowsThrough(seed, end);
  for (let i = lowerBound(movingRows, start); i < movingRows.length && movingRows[i]!.distance < end; i++) {
    const mrow = movingRows[i]!;
    for (const spec of mrow.row) {
      const motion: MotionParams = {
        anchor: mrow.distance,
        amplitude: spec.amplitude,
        wavelength: spec.wavelength,
        phase: spec.phase,
      };
      obstacles.push({
        kind: "moving-barrier",
        lane: spec.center,
        x: movingBarrierX(spec.center, motion, mrow.distance),
        z: -mrow.distance,
        motion,
      });
    }
  }

  const spills = oilThrough(seed, end);
  for (let i = lowerBound(spills, start); i < spills.length && spills[i]!.distance < end; i++) {
    const spill = spills[i]!;
    for (const lane of spill.lanes) {
      obstacles.push({ kind: "oil", lane, x: laneX(lane), z: -spill.distance });
    }
  }

  const ramps = rampThrough(seed, end);
  for (let i = lowerBound(ramps, start); i < ramps.length && ramps[i]!.distance < end; i++) {
    const ramp = ramps[i]!;
    obstacles.push({
      kind: "ramp",
      lane: ramp.lane,
      x: laneX(ramp.lane),
      z: -ramp.distance,
      barrierDistance: ramp.barrierDistance,
    });
  }

  return { index, obstacles };
}
