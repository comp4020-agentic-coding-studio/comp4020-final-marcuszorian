import { describe, expect, it } from "vitest";
import { archiveAge, shiftDay, todayUtc } from "../client/src/days.ts";

// README: "Older days render visibly more worn than today." The wear itself is
// pixels (postfx.ts's setArchiveAge) and is judged by eye. What can be checked
// is the number driving it: today is pristine, older is never less worn than
// newer, and the oldest days bottom out rather than overflowing. If this
// breaks, an old day could look newer than yesterday, and the archive stops
// reading as time.
describe("older days are never less worn than newer ones", () => {
  it("leaves today untouched", () => {
    expect(archiveAge(todayUtc())).toBe(0);
  });

  it("wears monotonically with age, saturating at a month", () => {
    let previous = archiveAge(todayUtc());
    for (let back = 1; back <= 60; back++) {
      const age = archiveAge(shiftDay(todayUtc(), -back));
      expect(age, `${back} days back is less worn than ${back - 1}`).toBeGreaterThanOrEqual(previous);
      expect(age).toBeLessThanOrEqual(1);
      previous = age;
    }
    expect(archiveAge(shiftDay(todayUtc(), -1))).toBeGreaterThan(0);
    expect(archiveAge(shiftDay(todayUtc(), -30))).toBe(1);
  });
});
