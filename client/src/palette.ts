// The shared colour vocabulary for the neon/vaporwave visual direction — see
// plan.md and doc/adr/0003-visual-direction.md for why these sixteen and no
// others. One source of truth: the 3D scene (as 0xrrggbb numbers for three.js
// materials) and the HUD (as CSS custom properties) both read from this file,
// so they can't drift apart. `applyPaletteCssVars()` writes the CSS side onto
// `:root` once at startup; `client/index.html`'s stylesheet also hardcodes the
// same hex values as `var(--token, #fallback)` defaults, so the two can never
// visibly disagree even before that first write lands.
//
// Anchored on two cited sources (see plan.md "Palette (locked)"): the
// SynthWave '84 VS Code theme's published token set, and color-hex's "Outrun"
// community palette. Never pure black (#000000) — see plan.md for why.

export interface PaletteToken {
  /** CSS-ready "#rrggbb", lowercase. */
  hex: string;
  /** three.js-ready 0xrrggbb. */
  three: number;
}

function token(hex: string): PaletteToken {
  return { hex, three: parseInt(hex.slice(1), 16) };
}

export const palette = {
  void: token("#0d0221"), // scene background, fog, sky zenith
  surface: token("#241b2f"), // HUD panel ground
  raised: token("#262335"), // modal / raised surface
  magenta: token("#ff2a6d"), // primary accent — sun, car, speed lines
  pink: token("#ff7edb"), // softer magenta — glow halos, small text
  cyan: token("#05d9e8"), // grid lines, HUD
  laserCyan: token("#36f9f6"), // highlights, headlight cores, wireframes
  purple: token("#7b2fbe"), // wireframe mountains, mid-sky, far grid
  violet: token("#8c52ff"), // sky bridge stop, secondary UI
  lavender: token("#b967ff"), // ghost cars — the vaporwave inflection
  orange: token("#ff8b39"), // sun mid-band, horizon, warm rim light
  gold: token("#fede5d"), // sun top band, score
  red: token("#fe4450"), // crash, danger, obstacles
  mint: token("#72f1b8"), // personal best improved
  hotWhite: token("#fff5f6"), // the core of every neon — primary HUD text
  lilac: token("#848bbd"), // de-emphasised secondary text
} as const;

export type PaletteKey = keyof typeof palette;

// A couple of scene-only derived surfaces that aren't UI tokens, so they
// don't belong in the table above — the road needs something between `void`
// and `surface` to read as a dark material rather than a hole in the world.
export const roadSurface = token("#201936");
// Same reasoning one step lighter, for the solid objects standing *on* the
// road: the car hull and the barrier frames. `void` would be correct for "an
// unlit dark body", but it's also the background and the fog colour, so a hull
// painted in it reads as a silhouette-shaped hole rather than a dark object
// catching the rim light.
export const gunmetal = token("#2e2a3f");

/** Writes every token as a `--<key>` custom property on `:root`. */
export function applyPaletteCssVars(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(palette)) {
    root.style.setProperty(`--${key}`, (value as PaletteToken).hex);
  }
}
