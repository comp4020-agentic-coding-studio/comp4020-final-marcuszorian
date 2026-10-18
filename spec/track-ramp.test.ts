import { describe, expect, it } from "vitest";
import { CHUNK_LENGTH, chunkFor, RAMP_MIN_LEAD_TO_HAZARD } from "../client/src/track.ts";

// Ramp placement's own invariant (doc/adr/0013, doc/adr/0014): each ramp
// pairs with one specific single-lane static-barrier row — the one it
// "jumps" — sitting RAMP_MIN_LEAD_TO_HAZARD before it, in that barrier's own
// lane, with nothing else (another fatal hazard, or a second ramp) between
// them. Sampled across a wide span of several seeds — the same style as the
// existing sampled moving-barrier solvability check in track.ts itself —
// rather than asserted for one hand-picked case, since the generator is
// seed-dependent by construction (doc/adr/0002).
const SEEDS = ["2026-01-01", "2026-03-17", "2026-07-04", "2026-11-23"];
const CHUNKS_TO_SAMPLE = 400; // CHUNK_LENGTH * 400 = 8000m, well past where speed caps out

describe("a ramp pairs with the single-lane barrier it jumps", () => {
  for (const seed of SEEDS) {
    it(`holds across seed ${seed}`, () => {
      const ramps: { distance: number; lane: number; barrierDistance: number }[] = [];
      const fatalRows: { distance: number; lane: number | null }[] = [];
      for (let index = 0; index < CHUNKS_TO_SAMPLE; index++) {
        for (const obstacle of chunkFor(seed, index).obstacles) {
          const distance = -obstacle.z;
          if (obstacle.kind === "ramp") {
            ramps.push({ distance, lane: obstacle.lane, barrierDistance: obstacle.barrierDistance! });
          } else if (obstacle.kind === "barrier") {
            fatalRows.push({ distance, lane: obstacle.lane });
          } else if (obstacle.kind === "moving-barrier") {
            fatalRows.push({ distance, lane: null }); // only one lane known per obstacle for a static row; moving rows have no single lane
          }
        }
      }
      expect(ramps.length).toBeGreaterThan(0); // the sampled span must actually contain ramps to prove anything

      for (const ramp of ramps) {
        // The ramp sits at least RAMP_MIN_LEAD_TO_HAZARD before its paired barrier.
        expect(ramp.barrierDistance - ramp.distance).toBeGreaterThanOrEqual(RAMP_MIN_LEAD_TO_HAZARD);
        // The ramp's own lane matches the barrier it's paired with.
        const paired = fatalRows.filter((r) => r.distance === ramp.barrierDistance);
        expect(paired.length).toBeGreaterThan(0);
        expect(paired.every((r) => r.lane === ramp.lane)).toBe(true);
        // Nothing else fatal sits strictly between the ramp and its barrier.
        const between = fatalRows.filter((r) => r.distance > ramp.distance && r.distance < ramp.barrierDistance);
        expect(between).toHaveLength(0);
      }
    });
  }
});
