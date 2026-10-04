// Multi-stop colour gradients used by the sky, sun and grid shaders, plus the
// small codegen that turns a stop table into GLSL. Kept separate from
// palette.ts because these stops are shader implementation detail, not UI
// tokens — several of the hexes here (the sky's mid-blue bridge, the sun's
// near-white core) only ever appear inside a gradient and never stand alone
// as a colour someone picks for a button or a line of text.
//
// Exact stops are from plan.md's "Gradients" section, themselves drawn from
// a published CSS sky gradient and the retrowave-guide sunset recipe (see
// plan.md for citations). The one rule worth restating here: never blend
// orange straight into deep blue — it passes through muddy brown-grey — so
// the sky's purple (75%) and magenta (90%) stops exist purely as a bridge.
// Removing either visibly muddies the sky.

export interface GradientStop {
  /** Position along the ramp, 0..1. */
  at: number;
  hex: string;
}

export const skyGradientStops: GradientStop[] = [
  { at: 0.0, hex: "#0d0221" }, // zenith — matches the void background exactly
  { at: 0.3, hex: "#120458" },
  { at: 0.55, hex: "#3503a8" },
  { at: 0.75, hex: "#7b2fbe" }, // bridge stop 1 — do not remove
  { at: 0.9, hex: "#ff2a6d" }, // bridge stop 2 — do not remove
  { at: 1.0, hex: "#ff8b39" }, // horizon — this is also the fog colour
];

export const sunGradientStops: GradientStop[] = [
  { at: 0.0, hex: "#fff5c2" }, // overexposed white-gold core
  { at: 0.18, hex: "#fede5d" },
  { at: 0.45, hex: "#ff8b39" },
  { at: 0.72, hex: "#ff2a6d" },
  { at: 1.0, hex: "#c61e7a" }, // falling into the horizon haze
];

export interface GridStop extends GradientStop {
  alpha: number;
}

export const gridGradientStops: GridStop[] = [
  { at: 0.0, hex: "#05d9e8", alpha: 1.0 },
  { at: 0.35, hex: "#1e9fd4", alpha: 0.75 },
  { at: 0.7, hex: "#5a4fc4", alpha: 0.4 },
  { at: 1.0, hex: "#7b2fbe", alpha: 0.0 }, // fades to transparent, not to a flat colour —
  // that's what kills the horizon seam and the distant Moiré.
];

/** `"#ff2a6d"` → `"vec3(1.0000, 0.1647, 0.4275)"`. */
export function glslVec3(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
}

// Generates the GLSL for a piecewise-linear colour ramp over a float `t` in
// [0,1], as a sequence of statements assigning `vec3 col`. Chained `mix`
// calls driven by a clamped ratio is the standard trick for baking fixed
// gradient stops without dynamic-length uniform arrays: at t <= stops[i-1].at
// the ratio is 0 (mix is a no-op, `col` already holds the right colour from
// the previous step); at t >= stops[i].at it's 1 (col becomes the next
// colour exactly); in between it's a true linear blend. `varName` must be a
// `float` already in scope.
export function gradientGlsl(stops: GradientStop[], varName: string, outVar = "col"): string {
  const first = stops[0];
  if (!first) throw new Error("gradientGlsl: at least one stop required");
  const lines: string[] = [`vec3 ${outVar} = ${glslVec3(first.hex)};`];
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!;
    const stop = stops[i]!;
    const span = Math.max(stop.at - prev.at, 1e-4);
    lines.push(
      `${outVar} = mix(${outVar}, ${glslVec3(stop.hex)}, clamp((${varName} - ${prev.at.toFixed(4)}) / ${span.toFixed(4)}, 0.0, 1.0));`,
    );
  }
  return lines.join("\n  ");
}

// Same idea, for a scalar (alpha) ramp — used by the grid's distance fade.
export function gradientAlphaGlsl(stops: GridStop[], varName: string, outVar = "a"): string {
  const first = stops[0];
  if (!first) throw new Error("gradientAlphaGlsl: at least one stop required");
  const lines: string[] = [`float ${outVar} = ${first.alpha.toFixed(4)};`];
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!;
    const stop = stops[i]!;
    const span = Math.max(stop.at - prev.at, 1e-4);
    lines.push(
      `${outVar} = mix(${outVar}, ${stop.alpha.toFixed(4)}, clamp((${varName} - ${prev.at.toFixed(4)}) / ${span.toFixed(4)}, 0.0, 1.0));`,
    );
  }
  return lines.join("\n  ");
}
