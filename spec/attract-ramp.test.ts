import { describe, expect, it, vi } from "vitest";
import { chooseLane, obstaclesAhead } from "../client/src/attract.ts";
import * as track from "../client/src/track.ts";
import { chunkFor } from "../client/src/track.ts";
import type { Chunk, Lane, Obstacle } from "../client/src/track.ts";

// doc/adr/0019: once the hazard check alone has nothing to say (the current
// lane already has full COMFORTABLE_M clearance), `chooseLane` now also steers
// clear of a ramp sitting in that lane, provided a ramp-free lane exists with
// the same clearance and is safely reachable. This is strictly lower-priority
// than hazard avoidance: a ramp in the only safe lane is still driven over,
// and the pre-existing barrier/moving-barrier dodge logic above it is
// untouched either way.

const SEEDS = ["2026-01-01", "2026-03-17", "2026-07-04", "2026-11-23"];
const CHUNKS_TO_SAMPLE = 400; // matches spec/track-ramp.test.ts's span

// Finding a real-seed case needs the generator's internal caches walked
// sequentially from chunk 0 — same constraint spec/track-ramp.test.ts works
// under — so these scan forward rather than asking for one chunk cold.
function findIsolatedRamp(seed: string): { distance: number; lane: Lane } | null {
  for (let index = 0; index < CHUNKS_TO_SAMPLE; index++) {
    for (const obstacle of chunkFor(seed, index).obstacles) {
      if (obstacle.kind !== "ramp") continue;
      const rampDistance = -obstacle.z;
      // Stand 10m short of the ramp: close enough that the ramp itself is
      // inside the lookahead window, far enough that its paired barrier
      // (always at least RAMP_MIN_LEAD_TO_HAZARD, 55m, further on) is not.
      const carDistance = rampDistance - 10;
      const ahead = obstaclesAhead(seed, carDistance);
      const hasRealHazard = ahead.some((o) => o.kind === "barrier" || o.kind === "moving-barrier");
      if (!hasRealHazard) return { distance: carDistance, lane: obstacle.lane };
    }
  }
  return null;
}

describe("attract mode sidesteps an isolated ramp on open road", () => {
  for (const seed of SEEDS) {
    it(`finds a ramp-free lane instead of holding the ramp lane (seed ${seed})`, () => {
      const found = findIsolatedRamp(seed);
      expect(found).not.toBeNull();
      const { distance, lane } = found!;
      const want = chooseLane(lane, seed, distance);
      expect(want).not.toBe(lane);
    });
  }
});

describe("the real barrier/moving-barrier dodge from spec's existing coverage still holds", () => {
  for (const seed of SEEDS) {
    it(`steers away from a static barrier's lane regardless of ramps elsewhere (seed ${seed})`, () => {
      let found: { distance: number; lane: Lane } | null = null;
      for (let index = 0; index < CHUNKS_TO_SAMPLE && !found; index++) {
        for (const obstacle of chunkFor(seed, index).obstacles) {
          if (obstacle.kind !== "barrier") continue;
          const barrierDistance = -obstacle.z;
          const carDistance = barrierDistance - 10;
          if (carDistance <= 0) continue;
          found = { distance: carDistance, lane: obstacle.lane };
          break;
        }
      }
      expect(found).not.toBeNull();
      const { distance, lane } = found!;
      // chooseLane's hazard-avoidance branch must still win outright: it runs
      // before the ramp preference and is untouched by this change, so this
      // is unaffected by whatever ramps happen to sit elsewhere in the
      // lookahead for this seed.
      const want = chooseLane(lane, seed, distance);
      expect(want).not.toBe(lane);
    });
  }
});

// The two priority-ordering edge cases below ("every lane has a ramp" and "the
// only ramp-free lane is blocked by a hazard mid-slide") are rare, seed-timing
// dependent arrangements not worth hunting for in generated data — they test a
// decision rule, not track generation — so `chunkFor` is stubbed with a
// synthetic single chunk via `vi.spyOn`, the same way spec/invincible.test.ts
// hand-builds `Obstacle` literals rather than searching for real ones.
function fakeChunk(obstacles: Obstacle[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(track, "chunkFor").mockImplementation((seed, index): Chunk => {
    return index === 0 ? { index: 0, obstacles } : { index, obstacles: [] };
  });
}

describe("ramp avoidance never outranks hazard avoidance", () => {
  it("holds the current lane and drives over the ramp when every lane has one", () => {
    const spy = fakeChunk([
      { kind: "ramp", lane: -1, x: 0, z: -20 },
      { kind: "ramp", lane: 0, x: 0, z: -20 },
      { kind: "ramp", lane: 1, x: 0, z: -20 },
    ]);
    try {
      expect(chooseLane(-1, "fake-seed", 0)).toBe(-1);
    } finally {
      spy.mockRestore();
    }
  });

  it("holds the current lane when the only ramp-free lane isn't safely reachable", () => {
    // Lane -1 has a ramp; lane 1 is ramp-free and otherwise clear, but
    // reaching it means sliding through lane 0, where a barrier sits close
    // enough to violate CROSSING_DANGER_M. The dodge must be refused.
    const spy = fakeChunk([
      { kind: "ramp", lane: -1, x: 0, z: -20 },
      { kind: "barrier", lane: 0, x: 0, z: -8 },
    ]);
    try {
      expect(chooseLane(-1, "fake-seed", 0)).toBe(-1);
    } finally {
      spy.mockRestore();
    }
  });

  it("still dodges a real barrier even with a ramp sitting in another lane", () => {
    const spy = fakeChunk([
      { kind: "barrier", lane: -1, x: 0, z: -10 },
      { kind: "ramp", lane: 1, x: 0, z: -20 },
    ]);
    try {
      expect(chooseLane(-1, "fake-seed", 0)).not.toBe(-1);
    } finally {
      spy.mockRestore();
    }
  });
});
