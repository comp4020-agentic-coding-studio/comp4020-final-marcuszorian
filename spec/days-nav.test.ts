import { describe, expect, it } from "vitest";
import { ARCHIVE_EPOCH, canGoBack, canGoForward, shiftDay, todayUtc } from "../client/src/days.ts";

// The day selector gated navigation on /api/days — the days with recorded
// runs — rather than on the calendar. On a fresh database that list is just
// [today], so you could step back exactly one day and then the button greyed
// out for good: the archive looked broken when it was only empty. A day's
// track is a pure function of its date, so every date from the epoch to today
// is playable whether or not anyone has driven it.
//
// Unlike the rest of spec/, these run against the module directly: this is
// client logic with no HTTP surface, and it was unreachable from a test until
// the bounds came out of the DOM-bound class.
describe("archive navigation is bounded by the calendar, not by activity", () => {
  it("steps back many days from today, not one", () => {
    let seed = todayUtc();
    for (let i = 0; i < 5; i++) {
      expect(canGoBack(seed), `stuck after ${i} steps back, at ${seed}`).toBe(true);
      seed = shiftDay(seed, -1);
    }
  });

  it("stops at the epoch", () => {
    expect(canGoBack(ARCHIVE_EPOCH)).toBe(false);
    expect(canGoBack(shiftDay(ARCHIVE_EPOCH, -1))).toBe(false);
    expect(canGoBack(shiftDay(ARCHIVE_EPOCH, 1))).toBe(true);
  });

  it("never goes past today", () => {
    expect(canGoForward(todayUtc())).toBe(false);
    expect(canGoForward(shiftDay(todayUtc(), 1))).toBe(false);
    expect(canGoForward(shiftDay(todayUtc(), -1))).toBe(true);
  });

  it("shiftDay crosses month and year boundaries in UTC", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });
});
