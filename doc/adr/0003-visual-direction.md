# 0003. Neon/vaporwave as the visual direction, not generic polish

Status: accepted

## Context

C8 deliberately shipped with no visual polish — `plan.md`'s "Out of scope"
named it explicitly, and the README says so too: "no polish on the driving
itself. Proof of life, this week, is: the road exists, you can crash on it,
and it remembers you did." The README also already makes an argument about
what the game *is*: a ghost is "someone else was right here," a day is "a
real place, not just a label," and showing up again is the whole point. That
argument needed a visual language, and "make it look nice" isn't one.

The aesthetic actually fits the mechanic. Mark Fisher's hauntology — via
Derrida's *Specters of Marx* — reads vaporwave/synthwave as a "refusal to
give up on the desire for the future": a present haunted by futures that
never arrived, expressed through deliberately degraded media. This game's
ghosts are exactly that structure: a past run, still present, on a road you
can still drive. See [CCCB Lab, "Vaporwave: The Musical Wallpaper of Lost
Futures"](https://lab.cccb.org/en/vaporwave-the-musical-wallpaper-of-lost-futures/)
and [Fisher, *Ghosts of My Life*](https://en.wikipedia.org/wiki/Mark_Fisher).

Three sub-styles were weighed against each other, not just against "do
nothing":

1. **Full vaporwave** (pastel pink/cyan/lavender, light base, washed VHS
   look — Macintosh Plus's *Floral Shoppe*, Greek busts, mall aesthetics).
   Rejected as the *dominant* register for a reason that's actually
   measurable, not just taste: its light base fails HUD legibility at speed,
   and low-saturation pastels read as grey mush in motion, which is the
   opposite of what an endless driving game needs from its visual language.
2. **Synthwave/outrun** (saturated magenta/cyan/purple on a dark base, grid
   horizon, banded sun — the branch of the aesthetic literally named after
   an 1986 racing game). This is the one that's actually built out of racing-
   game furniture: dark base keeps the HUD legible, saturated edges against
   black give free depth/motion cues, warm-to-cool (sun to grid) gives a
   built-in near/far colour language.
3. **A generic "polish pass"** — brighter colours, maybe some glow, no
   argument behind any of it. Rejected because it's not a decision, it's the
   absence of one, and this project's own house style (see `0001-stack.md`'s
   four-option comparison) is to make the alternatives explicit and name why
   they lose.

## Decision

**Synthwave/outrun as the dominant register (~70% of the visual budget),
vaporwave pastels for the moments the game isn't moving — the ghosts
specifically, which are lavender rather than the player's magenta or the
road's cyan, the one deliberately "wrong-genre" colour in the scene, on
purpose.** Implemented entirely with **three@0.182.0's already-vendored
`examples/jsm`** (`EffectComposer`, `UnrealBloomPass`, `OutputPass`,
`ShaderPass`, `RGBShiftShader`, `FilmShader`, `HueSaturationShader`) — **zero
new dependencies**, consistent with this repo's existing bias against adding
packages for things a few lines of code or an already-installed addon can do
(`track.ts`'s hand-rolled PRNG is the precedent).

A `postprocessing`-style third-party library was considered and rejected for
the same reason: it would do selective bloom somewhat more cleanly than the
`toneMapped: false` + bright-emissive trick used here, but that's a real
dependency for an effect the bundled `UnrealBloomPass` already delivers well
enough once tuned against an actual render (see the Phase 1/2 commit
messages for the two tuning passes that took).

The full palette, gradient recipes, and phase-by-phase build order are in
`plan.md` rather than duplicated here — this record is the *decision*, not
the implementation log.

## Consequences

- **Track geometry stays frozen.** `0002-daily-seeded-archive.md` makes
  `(seed, distance) → road` a pure function shared by every client and every
  past day. Every change in this direction — palette, sky, bloom, the grid,
  the sun, camera feel, ghost materials — is materials, lighting,
  post-processing or decoration, never `track.ts`'s output. A future change
  that *does* need to touch the centerline is a new ADR, not an edit to this
  one or to 0002.
- **No test covers any of this.** `client/` was never under test (C8's own
  "out of scope" list says so explicitly), so a real render — screenshotted,
  not just read — is the only verification this direction gets. Every phase
  in `plan.md` ends with "look at it in a browser" for exactly this reason,
  and two real tuning mistakes were only caught that way: the sky's
  below-horizon fallback rendering as flat bright orange instead of fading
  to the void (a fade-angle constant that was 20° where "thin" was meant),
  and an early bloom pass tuned so hot it washed the player car's magenta
  out to pale pink.
- **The README's values constrain the aesthetic, not the other way round.**
  No leaderboard, however much an 80s arcade high-score table is *right
  there* in the reference material — ghosts stay things you drive past, per
  the README's own "good means" argument. Older days render more degraded
  (heavier chromatic aberration, grain, desaturation — `postfx.ts`'s
  `setArchiveAge()`, driven by `days.ts`'s `archiveAge()`): this is the one
  place the aesthetic and the archive mechanic are the same idea, not two
  things bolted together.
- **Fonts stay system fonts.** No Google Fonts or other external stylesheet
  was added — this is a deployed app with no CSP configured for a second
  host, not an environment where that's free, and the repo's own minimalism
  (no fonts loaded at all, previously) was worth keeping. The "chrome title"
  and HUD numerals fake a display-face feel with weight, letter-spacing and
  a gradient instead.
