import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { createPlayerCar, setPlayerGhostly, setPlayerTrim } from "../client/src/car-model.ts";
import { skinColor } from "../client/src/skins.ts";
import { palette } from "../client/src/palette.ts";

// Car skins are the one cosmetic change that touches a material the crash
// path already swaps (ADR 0010). Like spec/standings.test.ts and
// spec/days-nav.test.ts, this runs against the client module directly: three
// builds the materials fine under plain Node, and the thing worth pinning is
// pure state, not pixels.

describe("a skin id is a palette token key", () => {
  it("resolves to that token's colour, with magenta as the free default", () => {
    // The point of this rule (ADR 0010) is that nothing maps skin names to
    // hex values, so nothing can drift out of step with palette.ts.
    expect(skinColor("gold")).toBe(palette.gold.three);
    expect(skinColor("laserCyan")).toBe(palette.laserCyan.three);
    expect(skinColor(null)).toBe(palette.magenta.three);
    // An id the server has but this client doesn't know falls back rather
    // than rendering an undefined colour.
    expect(skinColor("not-a-token")).toBe(palette.magenta.three);
  });
});

describe("a skin is invisible the instant you become a ghost", () => {
  // The body's edge lines — the first LineSegments in the group, and the one
  // the trim material backs.
  const trimOf = (car: THREE.Group): string => {
    const lines = car.children.find((c) => c.type === "LineSegments") as THREE.LineSegments;
    return `#${(lines.material as THREE.LineBasicMaterial).color.getHexString()}`;
  };

  it("wears the skin while driving, lavender while dead, and the skin again on restart", () => {
    const car = createPlayerCar();
    setPlayerTrim(car, skinColor("gold"));
    const equipped = trimOf(car);
    expect(equipped).not.toBe(palette.lavender.hex);

    // The existing rule, which a skin must not break: crashing makes you
    // visually indistinguishable from every other ghost on the road. If a
    // skin survived this, "driving" and "just died" would look the same for
    // anyone wearing one.
    setPlayerGhostly(car, true);
    expect(trimOf(car)).not.toBe(equipped);

    // And it comes back on the next run — setPlayerTrim writes the colour
    // into the material setPlayerGhostly holds as its "solid" half, rather
    // than swapping in a new material the crash path has never heard of.
    setPlayerGhostly(car, false);
    expect(trimOf(car)).toBe(equipped);
  });

  it("can be re-skinned while dead, and shows the new colour on revival", () => {
    const car = createPlayerCar();
    setPlayerGhostly(car, true);
    setPlayerTrim(car, skinColor("mint"));
    setPlayerGhostly(car, false);
    expect(trimOf(car)).not.toBe(palette.magenta.hex);
  });
});
