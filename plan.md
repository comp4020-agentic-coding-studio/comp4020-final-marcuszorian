# nightly build: build plan

Living task list. The previous plan (the title screen, pause menu, settings
consolidation, and the crew/shop/cosmetics split) has shipped — its reasoning
lives in git history, not here. This plan starts the next piece of work
clean: two new obstacle kinds, requested with reference concept art (a
"Nightly Build" orthographic sheet: *Obstacle 01 — Kinetic Hazard Barrier*, a
mobile barricade on slider rails that sweeps laterally across lanes, and
*Obstacle 02 — Cyber-Slick*, a flat oil-spill splatter causing sliding/glitch
physics). Not a spec (that's the course's), not a decision record (those are
in `doc/adr/`).

---

## 1. Overview & goals

Today `track.ts` generates exactly one kind of obstacle: a static, lane-
filling barrier, placed by a seeded catalogue of hand-written `Pattern`s
whose solvability is asserted by `patternIsSolvable` (`doc/adr/0004`). This
plan adds two more hazard kinds without disturbing that generator's core
contract — `(seed, distance)` still determines everything a client needs to
render and collide against, which is what lets a ghost sit on the road you're
actually driving past (`doc/adr/0002`).

**What's new:**
1. **Moving barriers** — visually the same material language as the existing
   barrier (reuses `barrier-model.ts`'s frame/stud/edge construction) but
   recoloured to the hotter red/orange banding the concept art shows, mounted
   on a visible slider rig, and swept continuously across lane positions
   rather than sitting still. Fatal on contact, exactly like today's barrier
   — "moving" changes how it's dodged, not what happens if you don't dodge
   it. They can appear solo or in groups (two at once, phase-offset so they
   never block every lane simultaneously; or several in a row, the moving
   equivalent of a slalom), the same way static barriers already do.
2. **Oil spills** — a flat, non-fatal hazard. Driving over one doesn't crash
   the car; it forces a brief, uncommanded lateral drift (the same slide
   animation the car already plays on a lane change, but player-uncommanded
   this time), paired with an on-screen pop-up icon, and genuinely risks a
   crash afterward if that drift carries the car into a barrier or past the
   edge of the next reaction window.

**What stays invariant:** the vaporwave visual language (`doc/adr/0003`),
three discrete lanes and one-shift-per-tap input (`doc/adr/0004`),
`(seed, distance)` as the pure function the whole archive/ghost model depends
on (`doc/adr/0002`), and the "never literally unsurvivable" guarantee a
pattern must provide. Nothing here touches the server, a route, or the data
model — this is the same *kind* of change ADR 0004 itself was: a client-side
generator and physics extension. It gets its own ADR anyway (see §5 Phase 1),
because it genuinely extends what ADR 0004 locked down — new obstacle kinds,
a new non-fatal category, and a new motion rule.

---

## 2. Requirements

### Obstacle model extension (`track.ts`)
- `Obstacle` gains a `kind: "barrier" | "moving-barrier" | "oil"`
  discriminant. Existing static barriers become `kind: "barrier"` with no
  behavioural change.
- **Moving barriers stay a pure function of `(seed, distance)`, not of
  wall-clock time.** Each moving-barrier obstacle carries motion parameters
  (an anchor distance, amplitude, wavelength, phase) rather than a fixed `x`;
  its lane position at any moment is computed from *the car's own distance*:
  `x = laneX(center) + amplitude * sin(2π · (distance − anchor) / wavelength)`.
  Two clients on the same seed computing the same obstacle at the same
  distance get the same answer, so nothing about ghosts (which only ever
  replay a recorded `(lane, distance)`, never re-run collision) changes.
- **Oil spills are placed the same way static barriers are** — a seeded
  distance, occupying 1 or 2 lanes, never all 3 — but are *excluded from
  `patternIsSolvable`'s blocking check*, because passing through one is
  always survivable; it adds risk, it doesn't remove a route. A new,
  parallel invariant takes its place: oil can't sit closer than a minimum
  follow-on distance to the next fatal hazard, so a forced drift always has
  room to resolve before the next thing that can actually end the run.
- **Moving-barrier groups reuse the existing `Pattern`/`Row` catalogue
  mechanism** — a new set of patterns, parallel to `PATTERNS`, describing
  solo and phase-offset-pair moving configurations, plus multi-row sequences
  for moving barriers one after another. Solvability for these is asserted by
  a sampled check: evaluate the occupied-lane set at many phase samples
  across the pattern's active window and assert at least one lane is always
  free — the continuous analogue of what `patternIsSolvable` does for
  discrete rows.

### Rendering & motion (`main.ts`, `barrier-model.ts`, new `oil-model.ts`)
- `createMovingBarrier()` in `barrier-model.ts`: the same frame/stud/edge/
  panel construction as `createBarrier()`, panel recoloured to the hotter
  orange/red banding from the concept art, with a slider/thruster rig added
  beneath it — module-scope geometry/materials shared across instances, same
  as the existing barrier.
- `createOilSpill()` in a new `oil-model.ts`: a flat, double-sided, roughly
  lane-width plane using a procedural shader in the same style as
  `barrier-model.ts`'s chevron panel (no texture, no new dependency), coloured
  from the existing palette's magenta/cyan/purple trio for the glitch-vapor
  look, plus a small ambient particle drift reusing `CrashBurst`'s point-
  sprite approach at a much lower, continuous rate (not a one-shot burst).
- `chunkAt` in `main.ts` tags moving-barrier meshes with their motion
  parameters in `userData`; a new per-frame update, called from
  `stepAndStream` using the `car.distance` already computed that frame,
  repositions every resident moving-barrier mesh's `x`. Oil spill meshes are
  static — no per-frame reposition needed, they sit flat like a decal.

### Collision & control (`car.ts`)
- `stepCar`'s existing collision loop already tests continuous `offset`
  against `obstacle.x ± half-width` without knowing about discrete lanes, so
  **the fatal-collision test itself doesn't change** for moving barriers —
  only how `obstacle.x` is computed before the loop runs.
- Oil is excluded from the fatal-collision branch and checked separately:
  contact starts a **forced drift** — new `CarState` fields (a countdown
  timer, a forced target offset) that override `shiftLane` input for that
  window, driven through the same slide/ease machinery `stepCar` already uses
  for a normal lane change. No new animation system, just a second source of
  "where offset is headed" that wins over player input while active.
- Player lane-shift input is ignored while a forced drift is active, the
  same guard shape as the existing `if (car.crashed) return;` in `shiftLane`.

### HUD & feedback
- A new, transient pop-up (parallel to `#crashed`, shown/hidden the same
  `hidden` way) appears for the duration of the forced drift and clears
  itself when it ends — no new interaction, purely a readout of a state that
  already drives the physics.
- No change to the crashed panel, score, or leaderboard; oil never crashes
  the car by itself.

### Attract mode (`attract.ts`)
- The autopilot (`chooseLane`/`obstaclesAhead`) treats a moving barrier as a
  hazard at its *predicted* position, not its current one — it already
  looks `LOOKAHEAD_M` ahead; it now evaluates the moving barrier's `x` at the
  distance it expects to reach it (via `speedAt`), not at the car's current
  distance. This keeps the demo honest (it can still crash, as documented
  behaviour already states) instead of giving it perfect-information dodging.
- Oil spills are not dodged by the autopilot at all — swerving to avoid a
  non-fatal hazard would look indecisive, and it isn't one. Simplest correct
  choice; flagged below for review.

---

## 3. Decisions made without asking, flagged for review
Called out here rather than buried in the phases, so any of them is easy to
redirect:
1. Oil spills are generated via the same seeded `Row`/distance mechanism as
   barriers, excluded from the solvability check (a lane "blocked" by oil is
   still passable), rather than invented as a wholly separate placement
   system.
2. Moving-barrier position is a function of the player's own `distance`, not
   wall-clock time — this preserves the `(seed, distance)` purity ADR 0002/
   0004 rely on, at the cost of the oscillation reading slightly differently
   at different approach speeds. This is the one piece of this plan that most
   needs sign-off, since it's the one place a careless choice would quietly
   break the archive contract.
3. The autopilot ignores oil spills entirely — never dodges them. Flagged in
   case you'd rather it visibly react.
4. Forced-drift duration and drift distance are new tunable constants, not
   specified in the brief — named plainly (e.g. `OIL_SLIDE_SECONDS`) so
   they're easy to retune after playtesting, the same way `SLIDE_SECONDS` and
   `ATTRACT_RESPAWN_SECONDS` already are.
5. A new ADR, `doc/adr/0012-moving-and-non-fatal-hazards.md`, documents this
   as an *extension* of ADR 0004, not a supersession — the static-barrier
   model and its solvability guarantee are untouched; this adds two new
   hazard kinds alongside it.

---

## 4. Hard constraints
1. **Zero new dependencies** — the oil shader and moving-barrier rig are
   hand-written like `barrier-model.ts`'s existing panel shader, using the
   `three@0.182.0` and DOM primitives already in use.
2. **`(seed, distance) → obstacles` stays reproducible** — a moving
   barrier's motion parameters, and an oil spill's placement, must be
   derivable from `seed` and `distance` alone, with no reliance on
   wall-clock time or per-session random state.
3. **No obstacle row may be truly unsurvivable.** The discrete solvability
   check (`patternIsSolvable`) keeps governing static-barrier rows unchanged;
   a new, analogous check governs moving-barrier patterns (sampled across
   phase); oil is excluded from both because it's never fatal by itself.
4. **No server-side change.** Entirely a generator/client change — no
   migration, no new route, no change to `best_runs` or ghosts.
5. **Nothing already shipped regresses**: static barrier placement/collision,
   the `e.repeat` lane-shift guard, ghost rendering, attract mode's honesty-
   about-crashing, coin/crew flows — none of which this plan has a reason to
   touch.
6. **Existing DOM ids and `spec/` invariants stay intact** — check
   `spec/README.md` and the existing `spec/*.test.ts` before adding the
   pop-up element or touching `index.html`.

---

## 5. Implementation phases

### Phase 1: ADR
- [x] Write `doc/adr/0012-moving-and-non-fatal-hazards.md`: context (two new
      obstacle kinds requested, concept art referenced), decision (extend
      `Obstacle` with a `kind` discriminant; moving barriers as a
      distance-driven oscillation; oil as a non-fatal, excluded-from-
      solvability hazard), alternatives considered (wall-clock-driven
      motion — rejected, breaks the pure-function contract), consequences
      (explicitly: ADR 0004's static-barrier model and solvability proof are
      untouched; this is additive).

### Phase 2: Generator (`track.ts`)
- [x] Extend `Obstacle`/`Row`/`Pattern` types with a `kind` discriminant and
      motion/hazard parameters.
- [x] Add a moving-barrier pattern catalogue (solo + phase-offset pairs +
      multi-row sequences) and a sampled solvability check for it.
- [x] Add oil-spill placement (seeded distance/lane, 1–2 lanes, minimum
      spacing before the next fatal hazard), excluded from the
      blocking-lane solvability check.
- [x] Keep `chunkFor` returning everything needed to render and collide —
      including motion parameters for moving barriers — without needing
      wall-clock time.

### Phase 3: Models (`barrier-model.ts`, new `oil-model.ts`)
- [ ] `createMovingBarrier()`: reuse `createBarrier`'s frame/panel/stud/edge
      construction, recoloured per the concept art, with a slider rig added.
- [ ] `createOilSpill()`: flat procedural-shader splatter in the existing
      palette, plus a continuous low-rate particle drift reusing
      `CrashBurst`'s point-sprite approach.

### Phase 4: Physics & control (`car.ts`)
- [ ] Add forced-drift state to `CarState`; have `stepCar` apply it (same
      ease/slide math as a normal lane change) and have it override, not
      queue behind, player `shiftLane` input while active.
- [ ] Oil contact starts a forced drift instead of setting `crashed`.
- [ ] Moving-barrier `x` is recomputed from the obstacle's motion parameters
      and the car's current `distance` every physics step, both for
      collision and for rendering.

### Phase 5: Integration (`main.ts`)
- [ ] `chunkAt` builds moving-barrier and oil meshes alongside static
      barriers; moving-barrier meshes get their `x` updated every frame from
      `stepAndStream`.
- [ ] A new transient HUD pop-up, shown for the forced-drift duration,
      mirroring how `#crashed` is shown/hidden today.
- [ ] Keydown handler ignores `shiftLane` while a forced drift is active,
      next to the existing `car.crashed` guard.

### Phase 6: Attract mode (`attract.ts`)
- [ ] `obstaclesAhead`/`clearanceIn` account for a moving barrier's
      *predicted* position at estimated arrival distance, not its position
      at the car's current distance.
- [ ] Oil spills are not dodged by the autopilot (per §3.3).

### Phase 7: Verification
- [ ] `pnpm typecheck` and `pnpm test` (existing `spec/` suite) stay green —
      no server/API surface changed, so this should be a no-op for `spec/`.
- [ ] New generator-level checks (unit-level, alongside the existing track
      logic, verified the way `patternIsSolvable`'s invariant already is)
      confirming: no moving-barrier pattern ever blocks all three lanes at
      any sampled phase; oil never sits within the minimum spacing of the
      next fatal hazard.
- [ ] Browser smoke test: a moving barrier visibly slides across lanes and
      is fatal on contact; an oil spill is visibly distinct (glitch-vapor
      splatter), does not end the run on contact, and produces an
      uncommanded slide plus the pop-up; attract mode still looks honest (it
      can still crash) and doesn't visibly teleport-dodge a moving barrier
      at the last pixel.
