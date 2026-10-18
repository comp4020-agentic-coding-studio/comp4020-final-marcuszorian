import { describe, expect, it } from "vitest";
import { CHUNK_LENGTH, chunkFor, RAMP_MIN_LEAD_TO_HAZARD } from "../client/src/track.ts";

// Ramp placement's own invariant (doc/adr/0013), the counterpart to oil's
// OIL_MIN_LEAD_TO_HAZARD: a ramp's QTE needs guaranteed clear road for its
// whole camera-zoom/input window, so it may never sit closer than
// RAMP_MIN_LEAD_TO_HAZARD to the next fatal (barrier or moving-barrier)
// hazard. Sampled across a wide span of several seeds — the same style as
// the existing sampled moving-barrier solvability check in track.ts itself —
// rather than asserted for one hand-picked case, since the generator is
// seed-dependent by construction (doc/adr/0002).
const SEEDS = ["2026-01-01", "2026-03-17", "2026-07-04", "2026-11-23"];
const CHUNKS_TO_SAMPLE = 400; // CHUNK_LENGTH * 400 = 8000m, well past where speed caps out

describe("a ramp never sits too close to the next fatal hazard", () => {
  for (const seed of SEEDS) {
    it(`holds across seed ${seed}`, () => {
      const ramps: number[] = [];
      const fatalDistances: number[] = [];
      for (let index = 0; index < CHUNKS_TO_SAMPLE; index++) {
        for (const obstacle of chunkFor(seed, index).obstacles) {
          const distance = -obstacle.z;
          if (obstacle.kind === "ramp") ramps.push(distance);
          else if (obstacle.kind === "barrier" || obstacle.kind === "moving-barrier") fatalDistances.push(distance);
        }
      }
      fatalDistances.sort((a, b) => a - b);
      expect(ramps.length).toBeGreaterThan(0); // the sampled span must actually contain ramps to prove anything

      for (const ramp of ramps) {
        const nextFatal = fatalDistances.find((d) => d > ramp);
        if (nextFatal === undefined) continue; // the sample window ended before the next hazard; nothing to check
        expect(nextFatal - ramp).toBeGreaterThanOrEqual(RAMP_MIN_LEAD_TO_HAZARD);
      }
    });
  }
});
