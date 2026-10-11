import { describe, expect, it } from "vitest";
import { standings } from "../client/src/leaderboard.ts";
import type { Ghost } from "../client/src/net.ts";

// Ranking order is pure, so it gets a direct test rather than a browser check
// — the same crack in the client test boundary that spec/days-nav.test.ts
// opened. The tie rule is the part worth pinning: it is invisible until a day
// has two equal distances, and then it decides who is first.
const g = (username: string, distance: number): Ghost => ({ username, distance, lane: null });

describe("standings", () => {
  it("ranks furthest first", () => {
    const ranked = standings([g("b", 10), g("a", 300), g("c", 50)]);
    expect(ranked.map((r) => r.ghost.username)).toEqual(["a", "c", "b"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a tie alphabetically, not by arrival order", () => {
    const ranked = standings([g("zoe", 900), g("ada", 900), g("mal", 900)]);
    expect(ranked.map((r) => r.ghost.username)).toEqual(["ada", "mal", "zoe"]);
    // Sequential, not shared: tied players take adjacent positions decided by
    // name. See doc/adr/0009-leaderboard.md, which names this as a cost.
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("gives the same answer whatever order the runs arrive in", () => {
    const ghosts = [g("ada", 900), g("zoe", 900), g("mal", 120), g("bea", 900)];
    const forward = standings(ghosts).map((r) => r.ghost.username);
    const backward = standings([...ghosts].reverse()).map((r) => r.ghost.username);
    expect(forward).toEqual(backward);
    expect(forward).toEqual(["ada", "bea", "zoe", "mal"]);
  });

  it("does not mutate the array it is given", () => {
    const ghosts = [g("b", 1), g("a", 2)];
    standings(ghosts);
    expect(ghosts.map((x) => x.username)).toEqual(["b", "a"]);
  });

  it("ranks are 1-based and contiguous", () => {
    const ranked = standings([g("a", 5), g("b", 4), g("c", 3), g("d", 2)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});
