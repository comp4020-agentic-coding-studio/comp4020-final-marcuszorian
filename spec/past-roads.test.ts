import { describe, expect, it } from "vitest";
import { chunkFor, FEATURE_EPOCH } from "../client/src/track.ts";

// doc/adr/0021: `0459043`/`2646f09`/`baabd9d` each extended `chunkFor` with a
// new obstacle kind (moving barriers, oil, ramps, coins) reasoned carefully
// about `(seed, distance)` purity — but none asked whether turning a kind on
// reaches backwards into a seed that was already live, with real runs
// recorded against it, before the kind existed. It did:
// `docs/test/17-oct-playtest.md` is the record of seven real ghosts sitting
// on `2026-10-17`, a road none of them actually drove once the new kinds
// started applying to every seed, past or present, with no gate at all. This
// is the test that would have caught it, and the one that keeps catching it.
//
// The first fifteen obstacle positions below are pinned against the output
// of `chunkFor` as it stood at `edd63a6`, the commit immediately before
// `0459043` — the generator exactly as it was the day 2026-10-17 was "today"
// and seven people actually drove it. `rowsThrough`/`playlistFor`/
// `gateSpacingAt` (the whole static-barrier path) have not changed a single
// line since, so this also stands as a general regression check on static
// placement for any pre-epoch seed, not just a record of one bug.
const PRE_EPOCH_SEED = "2026-10-17";
const PINNED_PREFIX: readonly [lane: number, z: number][] = [
  [-1, -70],
  [0, -82.961341],
  [1, -96.34566],
  [-1, -138.787077],
  [1, -153.630767],
  [-1, -168.795441],
  [1, -184.267265],
  [1, -232.405161],
  [0, -282.911102],
  [1, -282.911102],
  [-1, -300.231125],
  [-1, -353.538755],
  [1, -353.538755],
  [-1, -371.734422],
  [1, -371.734422],
];

describe("a road already driven on never regenerates with a kind that didn't exist yet", () => {
  it(`pins ${PRE_EPOCH_SEED}'s obstacle prefix to the pre-0459043 generator`, () => {
    const produced: [number, number][] = [];
    for (let index = 0; produced.length < PINNED_PREFIX.length && index < 20; index++) {
      for (const o of chunkFor(PRE_EPOCH_SEED, index).obstacles) {
        produced.push([o.lane, Number(o.z.toFixed(6))]);
      }
    }
    expect(produced.slice(0, PINNED_PREFIX.length)).toEqual(PINNED_PREFIX);
  });

  it(`emits only "barrier" obstacles anywhere on ${PRE_EPOCH_SEED}, same as every other pre-epoch seed`, () => {
    for (const seed of [PRE_EPOCH_SEED, "2026-09-28", "2026-10-01", "2026-10-17"]) {
      for (let index = 0; index < 400; index++) {
        for (const o of chunkFor(seed, index).obstacles) {
          expect(o.kind, `${seed} chunk ${index} produced a ${o.kind}`).toBe("barrier");
        }
      }
    }
  });

  it("carries every post-0012/0013/0015 kind again from FEATURE_EPOCH onward", () => {
    const kinds = new Set<string>();
    for (let index = 0; index < 400; index++) {
      for (const o of chunkFor(FEATURE_EPOCH, index).obstacles) kinds.add(o.kind);
    }
    expect(kinds).toEqual(new Set(["barrier", "moving-barrier", "oil", "ramp", "coin"]));
  });

  it("is a date someone moved on purpose, not an accident of today's calendar", () => {
    // Pins the constant itself: a future refactor that quietly derives this
    // from `todayUtc()` or similar would still pass every other case here on
    // the day it ships, and only break the ghosts recorded on this record's
    // behalf months later — exactly the failure mode this whole record exists
    // to rule out.
    expect(FEATURE_EPOCH).toBe("2026-10-18");
  });
});
