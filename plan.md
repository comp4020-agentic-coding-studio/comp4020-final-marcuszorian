# nightly build: build plan

Living task list. The previous plan (two new obstacle kinds — moving
barriers and oil spills, `doc/adr/0012-moving-and-non-fatal-hazards.md`) has
shipped — its reasoning lives in git history, not here. This plan starts the
next piece of work clean: trick ramps, requested with reference concept art
(a "Nightly Build" orthographic sheet: *Asset 03 — Trick Launch Ramp*, a
non-fatal launch ramp with synth-flame FX at the lip, chevron hazard striping
on the slope, under-ramp hardware and rear booster-thrusters, plus a
top-centre quick-time-event prompt UI showing one input at a time).

---

## 1. Overview & goals

Today `track.ts` generates three obstacle kinds — static barrier, moving
barrier, oil — none of which reward anything. This plan adds a fourth,
**ramp**, and a new mechanic layered on top of it: driving onto a ramp starts
a quick-time input sequence (shown top-centre, one arrow at a time,
transitioning cleanly on a correct input or taking a red-cross "QTE error" on
a wrong input or a timeout), with the camera zooming closer for the
sequence's duration. Landing the full sequence pays a distance bonus; failing
it only forfeits that bonus — the run is untouched, never crashed. Which
trick sequences exist, and the bonus each pays, is a coin-bought catalogue —
tricks are purchased in the shop the same way car trim is (`doc/adr/0010`).

This is the same *kind* of change `doc/adr/0012` already made for moving
barriers and oil: extend the `Obstacle` discriminant, keep
`(seed, distance) → obstacles` a pure function, leave `patternIsSolvable`
meaning exactly what it already means for barrier/moving-barrier rows, and
give the new hazard its own narrower invariant instead of folding it into
that check. The shop half reuses `doc/adr/0010`'s pattern directly: a seeded
catalogue table, server-enforced unlock-with-coins, a client screen showing
what's affordable.

**What's new:**
1. **Trick ramps** — a non-fatal, lane-scoped obstacle. Contact starts a QTE
   instead of a crash (oil's precedent: "contact is not automatically a
   crash"). Placement is seeded and excluded from `patternIsSolvable`, but
   carries its own minimum-lead-to-next-fatal-hazard invariant, the same
   shape as oil's `OIL_MIN_LEAD_TO_HAZARD` — a ramp's QTE needs guaranteed
   clear road for its whole window, the same way a forced drift does.
2. **The trick QTE** — a small state machine (`trick.ts`, new) tracking the
   active sequence, step index, per-step countdown, and outcome. Drives a new
   top-centre HUD prompt and a camera zoom (`camera-rig.ts`). `car.distance`
   and `speedAt` keep running unmodified underneath, exactly as they do
   during oil's forced drift — a trick never pauses or alters the car's
   physics, only the input channel and the camera.
3. **Bought tricks** — a `tricks` catalogue (id, name, input sequence, bonus
   metres, cost) seeded in a migration the way `skins` is, unlocked with
   coins through the same check-and-deduct transaction `lib/skins.ts`
   already uses, surfaced as a second section of the existing Shop screen.
   Owning a trick is the only state — no equip concept, matching how the
   round's scope answer settled it.

**What stays invariant:** `(seed, distance) → obstacles` for ramp
*placement* (`doc/adr/0002`); `patternIsSolvable`'s existing meaning for
barrier/moving-barrier rows (`doc/adr/0004`/`0012`); three discrete lanes and
single-tap steering input (`doc/adr/0004`) — a trick's input channel is
additive (arrow-key vertical input), not a change to how steering works;
zero new dependencies (`doc/adr/0003`); no `best_runs` schema change — a
trick's bonus is just more `distance`, the same number that already is the
score, the leaderboard rank, and the coin-payout input.

**Explicitly not part of the seed contract:** which trick a given ramp
offers is chosen client-side, per attempt (`Math.random()` over the player's
owned tricks), not derived from `(seed, distance)`. It never affects road
geometry, collision, or the recorded ghost (`lane`, `distance`) — it's a
bonus-scoring overlay on top of an already-placed, seed-pure obstacle, not
something a ghost replay needs to reproduce.

---

## 2. Requirements

### Obstacle model extension (`track.ts`)
- `ObstacleKind` gains `"ramp"`, alongside `"barrier" | "moving-barrier" |
  "oil"`. Existing kinds are unchanged.
- Ramps are lane-scoped (one lane), seeded the same `distance`-cursor way oil
  is (own cache, own start distance/interval).
- Excluded from `patternIsSolvable` (never fatal), but gated by a new
  `RAMP_MIN_LEAD_TO_HAZARD` invariant — reusing `firstFatalDistanceAtOrAfter`
  and the `oilDistanceFor`-style pullback — so a ramp never sits close enough
  to a fatal hazard that the QTE's camera zoom and input window would run out
  of clear road.
- A ramp also keeps clear of existing oil/moving-barrier placements in the
  same lane (generalising the `oilNearLane0`/`movingBarrierNearLane0`
  clearance checks already in this file), so hazards never stack.
- `chunkFor` emits `kind: "ramp"` obstacles the same way it emits oil.

### Model (`ramp-model.ts`, new)
- `createRamp()`: launch-lip/slope geometry with a chevron panel shader
  (adapted from `barrier-model.ts`'s `panelFragment`, recoloured per the
  concept art), two flame emitters at the launch-lip corners (point-sprite
  particles, following `oil-model.ts`'s `OilDrift` / `crash-fx.ts`'s
  `CrashBurst` precedent — upward-biased, flame-coloured, continuous), and
  simple under-ramp/booster-thruster block geometry for silhouette fidelity.

### Trick state (`trick.ts`, new)
- Pure state: `{ active, sequenceId, stepIndex, stepElapsed, outcome }`
  (`outcome: "prompt" | "ok" | "error" | "done"`).
- `startTrick(sequence)`, `advanceTrick(state, dt)` (times out a step),
  `submitInput(state, key)` (correct input advances or finishes; wrong input
  sets the error outcome and ends the sequence).
- No coupling to `CarState` — a trick never touches `car.distance`'s
  accumulation path except to add the bonus once, on success.
- Ramp contact (detected in `main.ts`, parallel to oil's contact check)
  picks a trick via `Math.random()` from the player's owned tricks (the
  always-available free default included) and calls `startTrick`.

### Input & HUD (`main.ts`, `index.html`)
- While a trick is active, arrow-key input (`ArrowUp`/`w`, `ArrowDown`/`s`,
  plus the existing `ArrowLeft`/`a`, `ArrowRight`/`d`) is routed to
  `submitInput` instead of `steer()` — same override-priority shape
  `isDrifting(car)` already uses to suspend steering during oil's drift.
- New `#trickPrompt` panel, top-centre, `hidden` by default: shows the
  current input glyph (and optionally the next, per the concept art's
  sequence read), a clean transition on a correct input, and a red-cross
  overlay/fade on error or timeout — same `panel` styling and `hidden`-toggle
  convention as `#oilPopup`.
- `frame()` advances the trick timer and toggles the prompt the same way it
  already toggles `oilPopupEl.hidden` from `isDrifting(car)`.
- On success, `car.distance += trick.bonusMetres` once, at the moment the
  sequence completes; the HUD score readout already reads `car.distance`
  every frame, so no separate display wiring is needed.

### Camera zoom (`camera-rig.ts`)
- A new eased "trick zoom" scalar (0..1), smoothed with the same `#ease`
  exponential-smoothing helper `CameraRig` already uses for FOV and bank,
  blended toward 1 while a trick is active and back to 0 once it ends.
- Applied as a narrower FOV offset and a small pull-in toward the car,
  layered on top of the existing chase-cam math in `updateCamera` — not a
  replacement for it.

### Attract mode (`attract.ts`)
- No new behaviour: `kind: "ramp"` is non-fatal, so the existing
  lookahead-for-danger logic (which already only reacts to hazards that can
  end the run) ignores it the same way it already ignores oil. The autopilot
  never engages a trick.

### Shop & server (coin-bought tricks)
- `migrations/0004_tricks.sql`: `tricks` table (`id TEXT PRIMARY KEY, name,
  sequence TEXT` — a JSON-encoded array of input tokens, `bonus_metres
  INTEGER, cost INTEGER`), seeded with several named tricks at increasing
  cost/bonus; `user_tricks` join table (`user_id, trick_id`), mirroring
  `user_skins` exactly, including its idempotent-insert shape.
- `src/server/lib/tricks.ts`: `catalogue(db, userId)` and `unlockTrick(db,
  userId, trickId)`, copying `lib/skins.ts`'s shape verbatim — conditional-
  UPDATE balance deduction inside one transaction, `INSERT OR IGNORE` for
  idempotence, no equip function (tricks have no equipped state).
- `src/server/routes/tricks.ts`: `GET /api/tricks` (`optionalAuth`, like
  `/api/skins`), `POST /api/tricks/:id/unlock` (`requireAuth`, 402 on
  insufficient coins, 404 on unknown id), mounted in `routes/index.ts`
  alongside `skinsRouter`.
- Client: `net.ts` gets a `Trick` type plus `getTricks()`/`unlockTrick(id)`,
  mirroring `Skin`/`getSkins`/`unlockSkin`; `shop.ts` gains a second
  catalogue section (tricks) reusing the same row/button/afford pattern as
  the trim list; `index.html`'s `#shopScreen` gains a `.shop-tricks` list
  beside the existing `.shop-list`. `cosmetics.ts` is untouched — tricks are
  never equipped.
- A free default trick (one simple sequence, modest bonus) is always
  available without purchase, the same way magenta trim is always worn
  without being a `skins` row.

---

## 3. Decisions made without asking, flagged for review
Called out here rather than buried in the phases, so any of them is easy to
redirect:
1. Ramps occupy one lane, not the full road width — consistent with how oil
   and single-lane barrier rows already size their hitboxes, even though the
   concept art's orthographic sheet doesn't make road-width context explicit.
2. The car is not airborne or invulnerable during a trick. Instead, ramp
   placement guarantees enough clear road after it (the minimum-lead
   invariant) that there's nothing to hit. Simpler than a second "can't
   crash right now" state alongside oil's forced drift; flagged in case
   playtesting wants real invulnerability instead.
3. Trick selection is `Math.random()`, not seeded — it only affects which
   QTE prompt a player sees and their own bonus size, never the track or
   another player's experience of that ramp, so seeding it would buy
   determinism this feature has no use for.
4. The trick catalogue is bought (owned), never equipped — every owned trick
   is simply in the pool a ramp can draw from. No UI exists to prefer one
   trick over another before a run.
5. Attract mode does not seek ramps or play tricks — the autopilot already
   ignores oil for the same reason (engaging a non-fatal hazard would look
   indecisive, and a demo "failing a QTE" has no story worth telling behind
   a menu).
6. One shop screen, two catalogue sections (trim, tricks), rather than a new
   top-level destination — avoids a fourth `Screen`/`Destination` enum value
   for what is, mechanically, the same "spend coins, own a thing" flow
   already on that screen.
7. A new ADR, `doc/adr/0013-trick-ramps.md`, extends `0004`/`0012` the way
   `0012` extended `0004` — ramp placement and its own solvability-adjacent
   invariant are additive; trick selection living outside the seed contract
   is the one piece of this plan that most needs sign-off, since it's the
   one place a careless choice could have (but doesn't) touched the
   archive/ghost contract.

---

## 4. Hard constraints
1. **Zero new dependencies** — the ramp's chevron shader and flame FX are
   hand-written like every other hazard model in this codebase.
2. **`(seed, distance) → obstacles` stays reproducible** for ramp
   *placement* — a ramp's distance and lane are derivable from `seed` and
   `distance` alone. Trick selection is explicitly exempt (§1, "not part of
   the seed contract").
3. **No obstacle row may be truly unsurvivable.** `patternIsSolvable` keeps
   governing barrier/moving-barrier rows unchanged; ramps are excluded
   (never fatal) and instead prove a narrower "clear road after this" bound.
4. **No `best_runs` schema change, no change to `runs.ts` or
   `lib/coins.ts`.** The bonus is just more `distance`, computed client-side
   before the normal `postRunEnd` call that already exists.
5. **Nothing already shipped regresses**: barrier/moving-barrier/oil
   placement and collision, the `e.repeat` lane-shift guard, ghost
   rendering, attract mode's honesty-about-crashing, the shop/cosmetics
   split, coin settlement.
6. **Existing DOM ids and `spec/` invariants stay intact** — check
   `spec/README.md` and the existing `spec/*.test.ts` before adding the
   `#trickPrompt` element or touching `index.html`.

---

## 5. Implementation phases

### Phase 1: ADR
- [ ] Write `doc/adr/0013-trick-ramps.md`: context (concept art, QTE
      requirement, shop purchase requirement), decision (ramp as a fourth
      `Obstacle` kind excluded from `patternIsSolvable` with its own
      min-lead invariant; trick selection is per-attempt client state, not
      part of the seed contract; bonus folds into `distance` rather than a
      new score column; tricks are a bought-not-equipped catalogue like
      skins), alternatives considered (seeding trick choice — rejected, no
      contract needs it; airborne invulnerability — deferred),
      consequences (0004/0012's solvability guarantee untouched; 0010's
      coin/unlock pattern reused verbatim; no schema change to `best_runs`).

### Phase 2: Generator (`track.ts`)
- [ ] Extend `ObstacleKind` with `"ramp"`.
- [ ] Add ramp placement: seeded distance + one lane, reusing the
      `oilThrough`-style cache/cursor pattern (own `rampCache`, own
      `RAMP_START_DISTANCE`/`RAMP_INTERVAL_METRES`).
- [ ] Add `RAMP_MIN_LEAD_TO_HAZARD` via the same `firstFatalDistanceAtOrAfter`
      pullback logic `oilDistanceFor` already uses.
- [ ] Generalise the near-lane clearance checks so a ramp doesn't land on an
      existing oil spill or moving-barrier row in the same lane/window.
- [ ] `chunkFor` emits `kind: "ramp"` obstacles the same way it emits oil.

### Phase 3: Model (`ramp-model.ts`, new)
- [ ] `createRamp()`: frame/slope geometry, chevron panel shader (adapted
      from `barrier-model.ts`), two launch-lip flame emitters (point-sprite
      particles per `oil-model.ts`/`crash-fx.ts`), under-ramp/thruster
      geometry.

### Phase 4: Trick state (`trick.ts`, new)
- [ ] `TrickState` type and `startTrick`/`advanceTrick`/`submitInput`.
- [ ] Ramp-contact detection in `main.ts` picks a trick via `Math.random()`
      from the player's owned tricks (default included) and starts it.

### Phase 5: Input & HUD wiring (`main.ts`, `index.html`)
- [ ] Arrow keys route to `submitInput` while a trick is active, ahead of
      `steer()`, mirroring `isDrifting(car)`'s existing override.
- [ ] New `#trickPrompt` panel: current/next glyph, correct-input
      transition, red-cross error/timeout state, `panel`-styled, `hidden`
      by default.
- [ ] `frame()` advances the trick timer and toggles the prompt.
- [ ] On success, add the trick's bonus to `car.distance` once.

### Phase 6: Camera zoom (`camera-rig.ts`)
- [ ] Add an eased trick-zoom scalar using the existing `#ease` helper;
      blend a narrower FOV and camera pull-in on top of the existing
      chase-cam math while a trick is active.

### Phase 7: Attract mode (`attract.ts`)
- [ ] Confirm (no code change expected) that `kind: "ramp"` is already
      ignored by the lookahead-for-danger logic the same way oil is, since
      both are non-fatal.

### Phase 8: Server (migration, lib, route)
- [ ] `migrations/0004_tricks.sql`: `tricks` + `user_tricks` tables, seeded
      catalogue.
- [ ] `src/server/lib/tricks.ts`: `catalogue()` + `unlockTrick()`, mirroring
      `lib/skins.ts`.
- [ ] `src/server/routes/tricks.ts`: `GET /api/tricks`, `POST
      /api/tricks/:id/unlock`, mounted alongside `skinsRouter`.

### Phase 9: Client shop integration
- [ ] `net.ts`: `Trick` type, `getTricks()`, `unlockTrick(id)`.
- [ ] `shop.ts`: second catalogue section for tricks, same
      row/afford/purchase pattern as trim.
- [ ] `index.html`: `.shop-tricks` list in `#shopScreen`.

### Phase 10: Verification
- [ ] `pnpm typecheck` and `pnpm test` stay green.
- [ ] New server tests for the tricks route, mirroring `spec/skins.test.ts`'s
      structure: catalogue visibility, insufficient-coins refusal with no
      partial charge, 404 on unknown id, 401 signed-out.
- [ ] New generator-level check: a ramp is never placed within
      `RAMP_MIN_LEAD_TO_HAZARD` of the next fatal hazard, across a sampled
      seed/distance range (same style as the existing moving-barrier
      sampled-solvability check).
- [ ] Browser smoke test: driving onto a ramp triggers the camera zoom and
      the trick prompt; a correct full sequence adds the bonus to the
      visible score; a wrong key or a timeout shows the red-cross and ends
      the sequence with no score change and the run continuing; buying a
      trick in the shop with enough coins succeeds and a later run can draw
      it; buying with insufficient coins is refused and charges nothing;
      attract mode still looks honest and never reacts to a ramp.
