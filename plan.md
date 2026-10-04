# drift archive → neon: the visual direction

Living task list. Supersedes the C8 build plan (kept, in full, under **Carried
over from C8** at the bottom — those items are still open). Not a spec (that's
the course's), not a decision record (those are `doc/adr/`).

## Why this theme, and why it isn't decoration

The README already argues what good means here: *your trace is something you
drive past, not something you look up*; *a day is a real place, not just a
label*; *showing up again is the whole point*. The game is an archive of
ghosts — translucent people who were on this exact road on a day you can name
and go back to.

That is almost exactly what the vaporwave/synthwave aesthetic is *about*.
Mark Fisher's hauntology — via Derrida's *Specters of Marx* — reads the style
as a "refusal to give up on the desire for the future": a present haunted by
futures that never arrived, rendered through deliberately degraded media. The
decay of memory is its central visual theme, expressed as analogue
degradation. "Vaporware" is itself a product announced and never shipped — a
specter in the system.

So the argument this repo should make is not "neon looks cool." It's:

> The game is a haunted archive. The aesthetic of haunted archives is
> vaporwave. Every ghost on your road is a lost future — someone else's run,
> on a day that's gone, still sitting there at the metre mark where it ended.

This matters practically, because it tells us what to do when the aesthetic
and the design pull apart. **The README's values win.** Concretely:

- No leaderboard, no rank, no scoreboard panel — however tempting an 80s
  arcade high-score table is. Ghosts stay things you drive past.
- The ghost is the single most important object on screen. It should be the
  most carefully-made thing in the scene, not a translucent box with bloom.
- Past days should *feel* older. The archive is the mechanic; degradation is
  the aesthetic's native way of showing age. (See Phase 4.)

Sources, for the README rewrite and the ADR:
[CCCB Lab, "Vaporwave: The Musical Wallpaper of Lost
Futures"](https://lab.cccb.org/en/vaporwave-the-musical-wallpaper-of-lost-futures/)
· [Fisher, *Ghosts of My Life*
(Wikipedia)](https://en.wikipedia.org/wiki/Mark_Fisher) · ["Cultural
hauntology and nostalgia: vaporwave as a symptom of capitalist
realism"](https://www.academia.edu/44990540/Cultural_hauntology_and_nostalgia_vaporwave_as_a_symptom_of_capitalist_realism)
· [aesdes.org on the Outrun
aesthetic](https://www.aesdes.org/2023/02/01/aesthetics-exploration-outrun/)
(traces the cyan/magenta core to CGA's 4-colour mode and *Blade Runner*)

## Hard constraints this overhaul must respect

Audited, not assumed. Breaking any of these fails the build, CI, or the
archive's meaning.

1. **Track geometry is a contract.** ADR 0002 makes `(seed, distance) →
   road` a pure function shared by every client. A ghost at 340 m must sit on
   the same road for everyone, including on a day recorded weeks ago.
   `CHUNK_LENGTH`, `ROAD_HALF_WIDTH`, `CURVE_MAX`, `driftFor`, `centerXAt`
   and `chunkFor`'s obstacle placement are **frozen**. Materials, lighting,
   post-processing, decoration meshes and particles are free. Anything that
   moves the centreline retroactively invalidates every stored run and needs
   its own ADR.
2. **Zero new dependencies.** `three@0.182.0` already ships the full
   `examples/jsm` tree locally — `EffectComposer`, `RenderPass`,
   `UnrealBloomPass`, `OutputPass`, `ShaderPass`, `RGBShiftShader`,
   `FilmPass`, plus `lil-gui` and `stats` for debugging. Import via
   `three/addons/...` (the exports map aliases it to `examples/jsm/`); it
   bundles under esbuild and typechecks against the pinned
   `@types/three@0.182.0`. The repo has an explicit anti-dependency culture
   (`track.ts`: the PRNG is hand-written "so an agent writes them in a few
   obvious lines rather than pulling in a library"). Honour it.
3. **Shaders are template strings.** `scripts/build-client.ts` configures no
   esbuild `loader`, so `import "./grid.glsl"` fails the build. three's own
   `examples/jsm/shaders/*.js` are the in-repo precedent: GLSL as a template
   string on a plain object. Follow that. (If `.glsl` files become worth it,
   it's `loader: { ".glsl": "text" }` plus a `declare module` — one line each,
   no dependency — but don't bother unless the strings get unwieldy.)
4. **New assets must be emitted into `dist/client/`.** The Dockerfile's
   runtime stage copies only `dist`, `src`, `migrations`, `README.md` —
   `client/` doesn't exist in production. `build-client.ts` copies exactly one
   file today. A self-hosted font or texture needs an explicit copy step.
   Prefer things that need no assets at all.
5. **Keep these element ids** — all are `getElementById(...)!` and throw on
   null: `#score`, `#crashed`, `#crashedText`, `#restart`, `#usernameModal`,
   `#usernameForm`, `#username`, `#usernameError`, `#prevDay`, `#nextDay`,
   `#dayLabel`.
6. **Two documented bug-fixes must survive**: `.modal[hidden] { display:
   none }` (author CSS beats the UA stylesheet) and `side: THREE.DoubleSide`
   on the road (winding flips with drift sign). Both are commented; don't
   "clean them up."
7. **`/` must keep returning 200, and `/readme/` must keep carrying the
   README's headings in order** (`spec/invariants.test.ts`, run against the
   Docker image in CI). Adding README sections is safe; reordering headings or
   moving one into a fenced block is not.
8. **`client/src/**` must typecheck under `strict` + `verbatimModuleSyntax`**
   — the Dockerfile runs `pnpm typecheck` at build time, so a client type
   error blocks the deploy. Type-only imports need `import type`; relative
   imports keep the `.ts` extension.
9. **No test will catch a visual regression.** Nothing in `client/` is
   tested, deliberately (`plan.md` C8: "automated WebGL/visual E2E testing —
   API-level tests are the deliberate proxy"). C8 also records that browser
   smoke-testing found two real bugs the API tests missed. **Every phase below
   ends with "look at it in a real browser."** That is the only safety net
   there is.

## Palette (locked)

Tokens, not ad-hoc hexes. Define once in `client/src/palette.ts` and import
everywhere — the 3D materials and the CSS both read from the same list, so
they can't drift apart.

Anchored on the [SynthWave '84 theme
source](https://raw.githubusercontent.com/robb0wen/synthwave-vscode/master/themes/synthwave-color-theme.json)
(2.5M installs, the most-deployed palette in this style) and the
[color-hex Outrun palette](https://www.color-hex.com/color-palette/79202).

| Token | Hex | Role |
|---|---|---|
| `void` | `#0D0221` | Scene background, fog colour, sky zenith |
| `surface` | `#241B2F` | HUD panel ground |
| `raised` | `#262335` | Modal / raised surface |
| `magenta` | `#FF2A6D` | Primary accent — sun lower half, car, speed lines |
| `pink` | `#FF7EDB` | Softer magenta: glow halos, small pink text |
| `cyan` | `#05D9E8` | Grid lines, HUD |
| `laserCyan` | `#36F9F6` | Highlights, headlight cores, wireframes |
| `purple` | `#7B2FBE` | Wireframe mountains, mid-sky, far grid |
| `violet` | `#8C52FF` | Sky bridge stop, secondary UI |
| `lavender` | `#B967FF` | **Ghost cars** — the vaporwave inflection |
| `orange` | `#FF8B39` | Sun mid-band, horizon, warm rim light |
| `gold` | `#FEDE5D` | Sun top band, score |
| `red` | `#FE4450` | Crash, danger, obstacles |
| `mint` | `#72F1B8` | Personal best improved |
| `hotWhite` | `#FFF5F6` | **The core of every neon.** Primary HUD text |
| `lilac` | `#848BBD` | De-emphasised secondary text |

Three rules that come out of the research and are easy to get wrong:

- **Never pure black.** `#0D0221`, not `#000000`. Nothing can be darker than
  the background, so black destroys the entire shadow range; bloom has no hue
  to tint and reads as a sticker; and on OLED, pure black beside fast bright
  content smears. The style is a *lit night*, not a void.
- **Never blend orange straight into deep blue** — it passes through muddy
  brown-grey. Bridge through `purple` then `magenta`. The sky gradient's 75%
  and 90% stops exist only for this; delete either and the sky muddies.
- **The neon's core is whiter than its hue.** `#FF2A6D` renders as a
  `#FFF5F6` fill with a `#FF2A6D` *halo*, not as flat magenta. A uniformly
  saturated glow reads as coloured plastic. SynthWave '84 does exactly this,
  and puts a tiny `0 0 2px #000` contact shadow under every glow to keep the
  glyph edge crisp. Copy both moves.

### Gradients

**Sky** (zenith → horizon): `0% #0D0221 · 30% #120458 · 55% #3503A8 · 75%
#7B2FBE · 90% #FF2A6D · 100% #FF8B39`

**Sun** (top → bottom): `0% #FFF5C2 · 18% #FEDE5D · 45% #FF8B39 · 72%
#FF2A6D · 100% #C61E7A`, with horizontal transparent bands cut through the
lower ~40%, gaps **widening downward**.

**Grid lines** (near → far): `#05D9E8 @1.0 → #1E9FD4 @0.75 → #5A4FC4 @0.40 →
#7B2FBE @0.0`. Fade to *transparent*, not to the background colour — that's
what kills the horizon seam and the distant Moiré.

## Phases

Each is independently shippable and individually citable in PROCESS.md.
Stop after any one and the game still works.

### Phase 1 — Palette, sky, fog, bloom

The 80% of the effect. Everything after this is refinement.

- [ ] `client/src/palette.ts` — the token table above, exported as
      `0x`-number constants for three and a `--token` CSS custom-property
      string for the HUD. Single source of truth.
- [ ] Recolour in place: `scene.background`/`fog` → `void`; road → dark
      violet-grey; obstacles → `red`; player car → `magenta`; ghosts →
      `lavender`. Leave all geometry alone. **This step alone should already
      look like a different game.**
- [ ] `renderer.toneMapping = THREE.ACESFilmicToneMapping`. **Not Reinhard**
      — it desaturates magenta toward grey-pink and is the most common way
      this aesthetic gets ruined.
- [ ] Gradient sky: `ShaderMaterial` on a large `BoxGeometry`/sphere with
      `side: THREE.BackSide`, lerping the six sky stops by world-space Y.
      Render it ≤1.0 intensity — a blooming sky kills the sun's dominance.
- [ ] Fog colour must equal the sky's *horizon* colour, not its zenith, or
      geometry dissolves into the wrong band. `THREE.Fog` is fine; keep the
      existing 30/140 near/far until it's been looked at.
- [ ] `EffectComposer` with `RenderPass` → `UnrealBloomPass` → `OutputPass`.
      Start at strength ≈ 0.8, radius ≈ 0.6, threshold ≈ 0.95, then tune by
      eye. Threshold near 1.0 so only real emissives bloom. Replace
      `renderer.render(...)` with `composer.render()` in `frame()`, and
      resize the composer in the existing resize handler.
- [ ] Emissive intensities (linear, >1.0 is the point): headlight/sun core
      5–8×, neon cores 4–6×, car accents 2–3×, near grid 1.3–1.8×, far grid
      ≤1.0 (**must not bloom**, or the horizon turns to soup), car paint ≤1.0.
- [ ] **Look at it in a browser.** Compare against the C8 screenshot.

### Phase 2 — The grid, the sun, the horizon

The three motifs that make it unmistakably this genre rather than "a dark
game with bloom."

- [ ] **Ground grid.** A large plane under the road with a `ShaderMaterial`
      drawing the grid procedurally: `fract()` the world coords by cell size,
      `smoothstep` against `fwidth()` for resolution-independent
      anti-aliased lines, fade alpha to 0 toward the horizon. Scroll by
      feeding `car.distance` into a uniform — the grid moving toward you is
      most of the speed sensation. A magenta cross-grid at ~0.35 alpha over
      the cyan one is the classic two-colour look.
      *(`GridHelper` is the lazy alternative and looks it: no fade, no
      scroll, aliases badly at distance. Skip it.)*
- [ ] **The sun.** A billboarded plane on the horizon, fragment shader: the
      5-stop vertical gradient, a circular mask, and horizontal band gaps
      whose spacing widens toward the bottom. It should be the brightest
      object in the scene by a clear margin — that's what anchors the bloom.
- [ ] **Wireframe mountains.** Low-poly silhouette ridge in `purple`,
      seeded from the day's seed so each day's horizon differs. Static,
      parallaxed slowly. Cheap: one `LineSegments`, built once per seed.
- [ ] **Road treatment.** Emissive `cyan` edge lines along both road edges
      (these double as the "don't leave the road" signal the game already
      enforces but never communicates), plus scrolling centre-line dashes.
      This needs a `uv` attribute added to the road strip geometry — it
      currently has none. Adding UVs doesn't change positions, so the ADR 0002
      contract holds.
- [ ] **Look at it in a browser**, at speed, not stationary.

### Phase 3 — The HUD, the modal, `/readme/`

- [ ] Rewrite the `<style>` block in `client/index.html` against the palette
      tokens. Keep every id. Keep `.modal[hidden]`.
- [ ] Neon text: the layered `text-shadow` stack — tight `0 0 2px #000`
      contact shadow, then a mid halo, then a wide dim one, with the fill
      pushed toward `hotWhite`. Score in `gold`, tabular numerals
      (`font-variant-numeric: tabular-nums` is already there — keep it).
- [ ] Chrome gradient text for the title only, via `background-clip: text`,
      with the hard stop at 50% that makes it read as metal rather than as a
      gradient. **Never** for the score — parts of a chrome glyph sit at
      1.5–2:1 contrast.
- [ ] Day selector restyled as the archive control it actually is. This is
      the UI that most needs to feel like browsing a shelf of old tapes.
- [ ] A scanline overlay: `repeating-linear-gradient`, `pointer-events:
      none`, low opacity, plus a subtle vignette. Restraint — this is the
      single tackiest effect in the genre when overdone.
- [ ] **Theme `/readme/`.** It is currently raw unstyled markdown — Times New
      Roman, full width, white background — and `spec/README.md` says
      plainly: *"the marker reads it there."* Inline a `<style>` block in
      `src/server/routes/readme.ts` (matching how `index.html` does it, and
      avoiding any new static-asset plumbing). Dark ground, readable measure
      (~65ch), palette accents. Highest effort-to-reward ratio in the whole
      plan.
- [ ] **Accessibility pass.** From the measured contrast ratios against
      `#0D0221`: `hotWhite` 18.8:1, `gold` 15.1:1, `laserCyan` 15.3:1, `cyan`
      11.6:1, `pink` 8.8:1 — all fine. But `magenta` is **5.5:1** and
      `violet` **4.6:1**: usable, with no headroom, and *not* for small text —
      substitute `pink` where brand-pink text is wanted. `purple` at ~2.2:1 is
      decoration only. Two further notes: glow *lowers* real contrast below
      the computed figure (hence the dark contact shadow), and panel tiers are
      worse than the void — `magenta` on `surface` drops to 4.6:1, so test
      against the lightest surface a thing ever sits on.
- [ ] **`prefers-reduced-motion`**: disable scanline drift, flicker, glitch
      and camera shake entirely; keep bloom and colour (they aren't motion).
      No flashing faster than 3Hz anywhere — WCAG 2.3.1.
- [ ] **Look at it in a browser**, including at phone width.

### Phase 4 — Speed, ghosts, and the archive

Where the theme stops being paint and starts carrying the game's meaning.

- [ ] **Speed.** Widen camera FOV with speed (70° → ~85°, eased), add slight
      camera lag so it trails the car into turns, and bank the car model into
      its steering — roll is doing more work than almost anything else in
      selling arcade driving. Streaking particles past the camera. All
      cosmetic; `car.ts` physics untouched.
- [ ] **Ghosts, properly.** These are the point of the game and currently
      share one `MeshStandardMaterial` across every ghost. Give each a
      per-instance material so it can carry its own tint, make them emissive
      `lavender` with a soft falloff, and add a floating name label. They
      should read as *presences*, not obstacles — no collision, visibly
      insubstantial, beautiful rather than threatening.
- [ ] **Age the archive.** Older days render more degraded: stronger
      chromatic aberration (`RGBShiftShader` via `ShaderPass`), more grain,
      slightly desaturated. Today is crisp; a month ago is a worn tape. This
      is the one place where the aesthetic and the mechanic are the *same
      idea*, and it's worth more than any other item in this phase.
- [ ] **Crash.** Brief hit-stop (~80–120ms), a `red` screen flash, camera
      shake using trauma² decay (square the trauma value so shake falls off
      smoothly instead of cutting out), particle burst. Then the crash panel.
- [ ] **Dispose on prune.** Chunks and ghosts are currently `scene.remove`d
      but never `.dispose()`d. With flat shared materials that leaked
      harmlessly; with per-chunk shader materials and per-ghost materials it
      will not. Fix this *in* this phase, not after.
- [ ] **Low-spec fallback.** The target is a 256MB Fly machine serving
      phones. Clamp `pixelRatio` (already ≤2 — consider ≤1.5), consider
      half-resolution bloom, and offer a "reduce effects" toggle that drops
      the composer back to a plain render. Watch the bundle: baseline is
      **509KB raw / 130KB gzipped**, and the addons add perhaps 30–60KB.

## Process deliverables

The overhaul isn't done when it looks right — the course marks the record.

- [ ] **`doc/adr/0003-visual-direction.md`** — Status: accepted. Context: C8
      deferred visual polish; the README's "what good means" argues for
      traces and returning, and the aesthetic should serve that. Decision:
      synthwave/outrun as the dominant register (~70%), vaporwave pastels for
      the still moments and the ghosts (~20%), implemented with three's
      bundled addons and **no new dependencies**. Alternatives to rule out
      honestly: a generic "polish pass" (no argument behind it); full
      vaporwave pastel (fails HUD legibility at speed on a light base —
      that's the actual reason, and it's worth stating); a postprocessing
      library like `postprocessing` (better selective bloom, but a new
      dependency against the repo's grain for an effect the bundled
      `UnrealBloomPass` delivers). Consequences: geometry stays frozen per
      ADR 0002; no test covers any of it, so browser verification is the gate.
      **Write this before the code**, per `doc/adr/README.md` — an accepted
      record is never edited, only superseded.
- [ ] **README "what good means" update** — add the hauntology argument. The
      README already says *"no polish on the driving itself"* and *"this is a
      first version… the plan is for it to change"*; this is that change, and
      it should be argued, not just done. Append sections rather than
      reordering headings (`spec/invariants.test.ts` checks heading order).
- [ ] **One commit per phase**, so PROCESS.md can cite them individually.
      Markers follow links; they don't trawl.

## Open now, inherited (fix before any of the above ships)

These were already open at C8 cutoff. Two are latent CI failures.

- [ ] **`pnpm check:evidence` currently fails**, on two counts:
      `reflections/crit-8.md` doesn't exist (the sweep reads exactly
      `crit-8.md` / `crit-9.md` / `crit-10.md`), and `PROCESS.md` still
      contains its `TEMPLATE:` comment. Latent only because CI skips the step
      while the repo is private.
- [ ] **The commit `7328a8b` that the C8 plan says to cite does not exist on
      `main`.** It survives locally as a dangling object, so
      `check-evidence.ts`'s `git cat-file -e` passes on this machine and
      would **fail on a fresh CI clone**. Cite reachable commits instead —
      `c4b1084` (server), `1e290d1` (spec), `b2f2009` (the game), `357f8d1`
      (ADR convention + plan).
- [ ] **`PROCESS.md`** — yours to write; the spec asks how you directed,
      grounded and corrected the work.
- [ ] **`reflections/crit-8.md`** — yours to write; both prompts are about
      your own experience.
- [ ] Paste `FLY_API_TOKEN` into `mise.local.toml` for manual deploys.
- [ ] Flip the repo public and trigger `checks.yml` once — **deliberate,
      confirmed step; ask first.**
- [ ] Consider filling in `CLAUDE.md`. It's near-empty and explicitly marked
      ("the rules you hold the agent to are part of what gets marked"). This
      overhaul suggests three real rules: *geometry in `track.ts` is a frozen
      contract*; *shaders are template strings until a loader exists*;
      *nothing visual is done until it's been seen in a browser*.

## Out of scope

Audio (no engine note, no music — a real option later via Web Audio with no
new dependency, but it's a separate decision) · textures and image assets
(nothing in the plan needs one; keep it that way) · a car model beyond
shaded primitives · the leaderboard the aesthetic keeps inviting — the README
rules it out on purpose · real-time push (still the `scoreChanged()` seam) ·
touch controls · any change to `track.ts`'s output · WebGPU/TSL (would need
an ADR superseding 0001) · selective-bloom via a second render pass unless
threshold-based bloom proves insufficient in the browser.
