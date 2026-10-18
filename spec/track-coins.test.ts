import { describe, expect, it } from "vitest";
import { CHUNK_LENGTH, chunkFor } from "../client/src/track.ts";

// Coin trails are derived from gate rows (doc/adr/0015): every coin sits in a
// lane a nearby gate row leaves open, never in a lane that row blocks — the
// whole point is that the trail reads as "the line through the gate".
// Sampled across several seeds, the same style as track-ramp.test.ts and
// track-moving-barrier.test.ts, since placement is seed-dependent (ADR 0002).
const SEEDS = ["2026-01-01", "2026-03-17", "2026-07-04", "2026-11-23"];
const CHUNKS_TO_SAMPLE = 400; // CHUNK_LENGTH * 400 = 8000m

describe("coin pickups sit in a lane a nearby gate leaves open", () => {
  for (const seed of SEEDS) {
    it(`holds across seed ${seed}`, () => {
      const coins: { distance: number; lane: number }[] = [];
      const blockedRows: { distance: number; lane: number }[] = [];
      for (let index = 0; index < CHUNKS_TO_SAMPLE; index++) {
        for (const obstacle of chunkFor(seed, index).obstacles) {
          const distance = -obstacle.z;
          if (obstacle.kind === "coin") coins.push({ distance, lane: obstacle.lane });
          else if (obstacle.kind === "barrier") blockedRows.push({ distance, lane: obstacle.lane });
        }
      }
      expect(coins.length).toBeGreaterThan(0); // the sampled span must actually contain coins to prove anything

      for (const coin of coins) {
        // Nothing may block this coin's own lane at its exact distance.
        expect(blockedRows.some((r) => r.distance === coin.distance && r.lane === coin.lane)).toBe(false);
      }
    });
  }
});
