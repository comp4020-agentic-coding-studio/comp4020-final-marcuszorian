import { describe, expect, inject, it } from "vitest";
import * as THREE from "three";
import { ghostColor, GHOST_HUE_SPREAD } from "../client/src/ghosts.ts";
import { palette } from "../client/src/palette.ts";
import type { PaletteKey } from "../client/src/palette.ts";

// README: "a ghost is someone else was right here". That only works if you can
// tell a ghost from a living car at a glance, so ADR 0003 gives ghosts the one
// colour nothing else on the road wears: lavender. Nothing checked it. The
// per-player hue jitter was ±0.04, and the purchasable `violet` trim sits
// 0.035 from lavender, so some players' ghosts were violet: a ghost
// indistinguishable from someone's car. This pins the margin against the
// catalogue the server actually sells, not a list copied into the test.
const baseUrl = inject("baseUrl");

// Hue is a circle: 0.99 and 0.01 are neighbours.
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};
const hueOf = (c: THREE.Color): number => c.getHSL({ h: 0, s: 0, l: 0 }).h;
const hueOfToken = (key: PaletteKey): number => hueOf(new THREE.Color(palette[key].three));

// About 7 degrees of hue. Below this, at bloom and speed, two trims read as one.
const MIN_GAP = 0.02;

describe("a ghost never wears a living car's colour", () => {
  it("keeps every possible ghost hue clear of every trim for sale, the free default, and obstacle red", async () => {
    const res = await fetch(new URL("/api/skins", baseUrl));
    expect(res.status).toBe(200);
    const { skins } = (await res.json()) as { skins: { id: string }[] };
    expect(skins.length).toBeGreaterThan(0);

    const forbidden: [string, number][] = [
      ...skins.map((s): [string, number] => [`skin ${s.id}`, hueOfToken(s.id as PaletteKey)]),
      ["default magenta", hueOfToken("magenta")],
      ["obstacle red", hueOfToken("red")],
    ];

    // The extremes of the jitter, not just a sample of names: the worst ghost
    // is the one at the edge of the spread.
    const lavender = hueOfToken("lavender");
    for (const edge of [lavender - GHOST_HUE_SPREAD, lavender, lavender + GHOST_HUE_SPREAD]) {
      for (const [name, hue] of forbidden) {
        expect(hueGap(edge, hue), `a ghost at hue ${edge.toFixed(3)} is within ${MIN_GAP} of ${name}`).toBeGreaterThanOrEqual(MIN_GAP);
      }
    }
  });

  it("actually draws ghosts inside that spread, whatever the name", () => {
    const lavender = hueOfToken("lavender");
    for (let i = 0; i < 500; i++) {
      const hue = hueOf(ghostColor(`player-${i}-${i * 7919}`));
      // Small float slack: setHSL then getHSL round-trips through RGB.
      expect(hueGap(hue, lavender)).toBeLessThanOrEqual(GHOST_HUE_SPREAD + 1e-3);
    }
  });

  it("still tells two players' ghosts apart", () => {
    const hues = new Set(Array.from({ length: 50 }, (_, i) => hueOf(ghostColor(`p${i}`)).toFixed(4)));
    expect(hues.size).toBeGreaterThan(10);
  });
});
