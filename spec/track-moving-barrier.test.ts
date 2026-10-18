import { describe, expect, it } from "vitest";
import { CHUNK_LENGTH, chunkFor } from "../client/src/track.ts";

// A moving barrier's sweep crosses every lane over its cycle (its amplitude
// spans a full lane either side of the lane it's centred on), so it must
// never land near a static-barrier row at all — not just a row sharing its
// own lane. Without this, a static row that leaves only one lane open (e.g.
// a `clamp-outer` row blocking the two outer lanes) can sit close enough to
// a moving barrier centred on that one surviving lane that the sweep closes
// the player's only way through moments after the static row forced them
// into it — hit in actual play. Sampled across several seeds, the same style
// as spec/track-ramp.test.ts, since placement is seed-dependent by
// construction (doc/adr/0002).
const SEEDS = ["2026-01-01", "2026-03-17", "2026-07-04", "2026-11-23"];
const CHUNKS_TO_SAMPLE = 400; // CHUNK_LENGTH * 400 = 8000m, well past where speed caps out
const MOVING_LANE_CLEARANCE = CHUNK_LENGTH;

describe("a moving-barrier row never lands near a static-barrier row, in any lane", () => {
  for (const seed of SEEDS) {
    it(`holds across seed ${seed}`, () => {
      const movingDistances: number[] = [];
      const staticDistances: number[] = [];
      for (let index = 0; index < CHUNKS_TO_SAMPLE; index++) {
        for (const obstacle of chunkFor(seed, index).obstacles) {
          const distance = -obstacle.z;
          if (obstacle.kind === "moving-barrier") movingDistances.push(distance);
          else if (obstacle.kind === "barrier") staticDistances.push(distance);
        }
      }
      expect(movingDistances.length).toBeGreaterThan(0);
      expect(staticDistances.length).toBeGreaterThan(0);

      for (const moving of movingDistances) {
        for (const stat of staticDistances) {
          expect(Math.abs(moving - stat)).toBeGreaterThanOrEqual(MOVING_LANE_CLEARANCE);
        }
      }
    });
  }
});
