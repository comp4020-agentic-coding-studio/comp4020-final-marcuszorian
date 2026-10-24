import { describe, expect, it } from "vitest";
import {
  MOVING_PATTERNS,
  movingPatternIsSolvable,
  PATTERNS,
  patternIsSolvable,
} from "../client/src/track.ts";

// doc/adr/0004's solvability guarantee was checked by hand once, with a
// headless-browser harness, when the catalogue was first authored (see
// PROCESS.md) — `patternIsSolvable`/`movingPatternIsSolvable` were written to
// express that check but were never actually called from anywhere, static or
// moving. A pattern added or edited by hand since then could silently violate
// the guarantee with nothing to catch it. This runs both functions over the
// real catalogues so the invariant is enforced on every change, not just
// asserted in a comment.

describe("every static pattern in the catalogue is solvable", () => {
  for (const pattern of PATTERNS) {
    it(`${pattern.name}`, () => {
      expect(patternIsSolvable(pattern)).toBe(true);
    });
  }
});

describe("every moving pattern in the catalogue is solvable", () => {
  for (const pattern of MOVING_PATTERNS) {
    it(`${pattern.name}`, () => {
      expect(movingPatternIsSolvable(pattern)).toBe(true);
    });
  }
});
