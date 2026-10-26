# nightly build: build plan

Living task list. The previous plan (trick ramps + QTE + bought-trick
catalogue) has shipped in full — `trick.ts`, `ramp-model.ts`,
`migrations/0004-0006`, `src/server/lib/tricks.ts`,
`src/server/routes/tricks.ts`, and the shop's trick section all exist and
work. Its reasoning lives in `doc/adr/0013`-`0017` and git history, not here.
This plan starts five new, independent pieces of polish/feature work clean.

---

## 1. Overview & goals

Five changes, each scoped to touch as little as possible outside itself:

1. **Equip a favorite trick** in the cosmetics screen. Today a ramp hit draws
   uniformly at random from every trick the player owns
   (`client/src/main.ts:1172`, `ownedTricks[Math.floor(Math.random() *
   ownedTricks.length)]`). This adds a single-favorite equip concept —
   exactly skins' `equipped` pattern (`cosmetics.ts`, `lib/skins.ts`,
   `POST /api/skins/:id/equip`) — so a player can lock in which trick plays,
   and the random draw is replaced by "always play the equipped trick."
2. **Keystroke indicators** for tricks, shown in both the shop (purchase
   decision) and cosmetics (equip decision) trick rows — today those rows
   show only name/bonus/cost with no visual of the input sequence.
3. **Shop layout rework**: replace the vertical `.shop-list`/`.shop-tricks`
   with a horizontally-scrollable card row per section (skins, tricks), each
   card showing a lightweight animated CSS preview (no new 3D rendering
   infrastructure — the game's one `THREE.WebGLRenderer` in `main.ts` stays
   untouched).
4. **Interactive tutorial**: a dismissible guided tour that auto-launches once
   per new account and spotlights the game's menus (title → crew → shop →
   cosmetics → HUD/pause), plus a persistent "how to play" entry point to
   replay it later.
5. **Sun shape fix**: `client/src/sun.ts` builds the sun from a
   `PlaneGeometry(SUN_WIDTH, SUN_HEIGHT)` = `(150, 95)` (lines 12-13, 51) with
   a circular mask computed in UV space (lines 25-48) — the non-square plane
   stretches that circle into an oval. Fix: make width and height equal.

**Why only one new ADR:** only change #1 touches an existing explicit
architectural decision — `doc/adr/0013` states "owning a trick is the only
state... no `equipped` flag" (`src/server/lib/tricks.ts:6` repeats this
verbatim). That decision is being reversed, so it needs a superseding-style
record, `doc/adr/0018`. Changes #2-#5 are additive UI/visual work that don't
touch the stack, storage, or data model (CLAUDE.md's bar for needing an ADR)
— no new ADRs for those.

**Agent assignment:** phases that mirror an existing, working pattern
line-for-line (equip plumbing, migrations, cosmetics row wiring, running
typecheck/test) go to **haiku** subagents — narrow deviation, a reference
implementation to copy. Phases with no existing precedent to mirror and that
need visual/UX judgment (keystroke-glyph UI, the shop card rework, the
tutorial overlay, the sun's framing retune, and the final browser smoke
test) go to **sonnet** subagents instead. Each phase below is tagged with
its assigned model.

**What stays invariant:** the seed contract and `patternIsSolvable`
(untouched — nothing here touches `track.ts`); `best_runs`/`runs.ts`/
`lib/coins.ts` schema (untouched); zero new dependencies (CSS-only previews,
no new rendering libraries); existing DOM ids and `spec/` invariants (check
`spec/README.md` before touching `index.html`); the trick QTE itself
(`trick.ts`, camera zoom, HUD prompt) is unchanged — only *which* trick gets
drawn changes, not how the QTE plays out.

---

## 2. Requirements

### Feature 1 — Equip a favorite trick

**Reverted per doc/adr/0020.** This feature shipped as described below and
as doc/adr/0018, then was cut in full: the equip concept, the migration
column, the server/client plumbing, and the cosmetics trick section are all
removed, and a ramp hit draws at random from owned tricks again, exactly as
this section's own opening paragraph describes it working before this
feature existed. The requirements below are left as written, not rewritten,
as the record of what was built and then undone.

**Server:**
- `migrations/0007_trick_equip.sql`: add `equipped INTEGER NOT NULL DEFAULT
  0` to `user_tricks`, mirroring however `user_skins`/`skins` represents
  equipped (check `src/server/lib/skins.ts` and its migration for the exact
  shape — single-equipped-row enforcement, e.g. unset-then-set in one
  transaction — and copy it verbatim).
- `src/server/lib/tricks.ts`: add `equipTrick(db, userId, trickId)`,
  mirroring `lib/skins.ts`'s `equipSkin()` exactly — unset any existing
  equipped row for that user, then set the new one, inside one transaction.
  404 on unknown/unowned trick id.
- `src/server/routes/tricks.ts`: add `POST /api/tricks/:id/equip`
  (`requireAuth`), mirroring `routes/skins.ts`'s equip route shape (status
  codes, auth requirement).
- The always-owned `DEFAULT_TRICK` (`client/src/trick.ts:160`, "Quick Flip")
  needs an equip fallback — when no trick is equipped yet (new/existing
  accounts before this ships), treat it as the effective equipped trick,
  the same way unequipped skins fall back to magenta trim.

**Client:**
- `client/src/net.ts`: `Trick` type gains `equipped: boolean`; add
  `equipTrick(id)` mirroring `equipSkin(id)`.
- `client/src/cosmetics.ts`: add a tricks section to the cosmetics screen,
  structurally mirroring the existing skins section (`render`, `#row`,
  `#equip` — lines ~45-90) — one row per owned trick (including the default),
  each showing the keystroke indicator (see Feature 2) and an
  "equipped"/"equip" button wired to the new `equipTrick` call, re-rendering
  and (if cosmetics' `onTrimChange`-equivalent matters here) no car-repaint
  side effect is needed for tricks, just a UI state refresh.
- `client/src/main.ts:1172`: replace the `Math.random()` draw with "use the
  equipped trick" (falling back to `DEFAULT_TRICK` if the server reports none
  equipped). Remove the now-dead random-draw code path once this is in place
  — don't leave both.

### Feature 2 — Keystroke indicators

- Locate how the in-race `#trickPrompt` HUD currently renders a trick's
  input glyph (`client/src/main.ts`'s trick-prompt wiring, and/or
  `client/src/trick.ts`). If a shared glyph-mapping helper already exists
  (token like `"up"`/`"down"` → displayable arrow/icon), extract or reuse it
  — do not write a second, divergent glyph mapping.
- If no shared helper exists, add one (e.g. in `trick.ts`) mapping each
  input token in a `TrickSequence`'s steps to a small glyph/icon, used by
  three call sites: the HUD prompt (existing, refactor to use the shared
  helper if it isn't already a standalone function), the shop's trick row
  (`client/src/shop.ts`'s `#trickRow`, ~line 132), and cosmetics' new trick
  row (Feature 1).
- Shop and cosmetics trick rows render the full step sequence as an ordered
  row of glyphs (e.g. "↑ ↓ ↑"), not just the first step.

### Feature 3 — Shop layout rework

- `client/index.html`: replace `#shopScreen`'s vertical `.shop-list`/
  `.shop-tricks` (`<ul>` rows, ~lines 1310-1328) with two horizontally
  scrollable sections — one for skins, one for tricks — each a flex
  container with `overflow-x: auto` (CSS `scroll-snap-type: x mandatory`
  optional, for a cleaner feel) holding one card per item.
- New CSS (in `index.html`'s existing style block): `.shop-scroll` (flex row,
  overflow-x, snap), `.shop-card` (fixed width, padding, border — same
  visual language as the existing `.skin-row`/panel styling, not a new
  design system).
- Each skin card: the existing swatch, recolored/enlarged, with a CSS
  keyframe animation (e.g. a slow pulse/glow or gradient shimmer) standing
  in for an "animated preview" — no 3D rendering.
- Each trick card: the keystroke glyph sequence (Feature 2) with a CSS
  keyframe that cycles a highlight across the glyphs in order, looping, as
  the trick's "preview."
- `client/src/shop.ts`: update `render`/`renderTricks`/`#row`/`#trickRow` to
  emit the new card markup instead of the old `<li>` rows; keep the existing
  buy/unlock wiring (`#equip`, `#unlockTrick`) unchanged — this is a
  rendering/layout change, not a behavior change.
- Explicitly out of scope: no new `THREE.WebGLRenderer`, no per-item 3D
  canvases, no render-to-texture. If this later needs a real 3D preview,
  that's a separate plan.

### Feature 4 — Interactive tutorial

- New `client/src/tutorial.ts`: a small step-sequence overlay (`active, step,
  steps[]`), each step `{ screen, targetSelector, caption }`. Driving it:
  - A full-screen dimmed overlay with a spotlight cutout around
    `targetSelector` (or a simple highlighted-border box if a true spotlight
    mask is too heavy) and a caption box with **Next** / **Skip** buttons.
  - Steps walk: title screen controls → crew → shop (skins + tricks
    sections) → cosmetics (equip row) → back to racing HUD → pause menu.
    Where a step targets a non-title screen, the tutorial module drives
    navigation itself (reuse `screens.ts`'s existing screen-switching, don't
    reimplement it) rather than requiring the player to navigate manually.
  - **Skip** at any step ends the tour immediately and records it as seen.
- Trigger: auto-start once, right after first username creation for a
  brand-new account (hook into the existing username/first-login flow in
  `client/src/screens.ts`/`main.ts`). Persistence: a `localStorage` flag
  (e.g. `tutorial-seen`) — flagged below for review, since this is the one
  piece of state in this plan not stored server-side.
- Persistent access: add a small "how to play" / "?" button on the title
  screen (`client/index.html`) that re-launches the same tour on demand,
  wired to `tutorial.ts`'s start function directly (bypassing the
  first-run/seen check).
- New DOM: overlay container + caption/button elements, added to
  `index.html` following the existing `panel`/`hidden`-toggle convention
  used elsewhere (e.g. `#oilPopup`, `#trickPrompt`) — check `spec/README.md`
  before adding ids.

### Feature 5 — Sun shape fix

- `client/src/sun.ts`: change line 13 so `SUN_HEIGHT === SUN_WIDTH` (both
  150), making the `PlaneGeometry` square so the shader's UV-space circular
  mask (lines 25-48) renders as a true circle instead of an oval.
- Re-check `SUN_FORWARD_OFFSET`/`SUN_HEIGHT_OFFSET` (lines 14-15) and any
  caller in `main.ts`/`sky.ts` that assumes the old 150×95 footprint — the
  sun is now taller; if it visually clips the horizon/frame oddly, retune
  these offsets rather than reintroducing a non-square plane.
- Grep for `SUN_WIDTH`/`SUN_HEIGHT` usage outside `sun.ts` before changing,
  to catch any other assumption of the old dimensions.

---

## 3. Decisions made without asking, flagged for review

1. **Single-favorite equip, not multi-select or ordered loadout** (Feature
   1) — per direction given, mirrors skins exactly (one equipped item,
   server-authoritative). This removes the random-draw variety entirely;
   flagged in case playtesting wants some randomness retained among a
   player's favorites instead of one fixed trick.
2. **Tutorial seen-state in `localStorage`, not a server/DB column**
   (Feature 4) — avoids a schema change for a purely cosmetic UX flag, but
   means the tour re-triggers per-browser/device rather than per-account.
   Flagged in case cross-device consistency matters.
3. **Lightweight CSS preview, not any 3D rendering** (Feature 3) — per
   direction given, explicitly avoids new rendering infrastructure. Flagged
   because it's a smaller visual fidelity bar than "shows animations" might
   otherwise imply; a true 3D preview is a larger follow-up effort, not part
   of this plan.
4. **Sun fix keeps `SUN_WIDTH` (150) and grows `SUN_HEIGHT` to match**,
   rather than shrinking width to 95 — keeps the sun's horizontal prominence
   in frame but makes it visibly larger overall. Flagged as a one-line value
   to retune on visual pass if 150×150 reads too big.
5. **One new ADR (`0018`), not four** — only Feature 1 reverses an existing
   explicit architectural decision (`0013`'s "no equip" stance); Features
   2/3/4/5 are additive UI/visual work with no stack/storage/data-model
   change, so no ADR per CLAUDE.md's stated bar. Flagged in case the
   grading rubric expects an ADR per feature regardless.

---

## 4. Hard constraints

1. **Zero new dependencies** — CSS keyframes/scroll-snap only for previews
   and layout; no new rendering or animation libraries.
2. **No `best_runs`/`runs.ts`/`lib/coins.ts`/seed-contract changes** — all
   five features are UI, cosmetics-equip, and a shader/geometry tweak.
3. **Nothing already shipped regresses**: existing trick QTE mechanics,
   camera zoom, ramp placement/collision, shop purchase flow, skins
   equip/cosmetics flow, attract mode.
4. **Existing DOM ids and `spec/` invariants stay intact** — check
   `spec/README.md` and existing `spec/*.test.ts` before adding/renaming any
   `index.html` element id.
5. **`doc/adr/0013`/`0014` are read, not edited** — `0018` supersedes only
   the no-equip clause, written as a new file.

---

## 5. Implementation phases

### Phase 1: ADR — **haiku**
- [ ] Write `doc/adr/0018-equip-favorite-trick.md`: context (`0013`'s
      no-equip stance, why a favorite-equip concept is now wanted),
      decision (single `equipped` trick per user, mirroring skins' pattern
      verbatim; random draw at ramp-contact replaced by "always play
      equipped, falling back to default"), alternatives considered
      (multi-select pool, ordered loadout — both deferred), consequences
      (`0013`'s no-equip clause is superseded; nothing else in `0013`/`0014`
      changes).

### Phase 2: Server — trick equip — **haiku**
- [ ] `migrations/0007_trick_equip.sql`: `equipped` column on `user_tricks`,
      matching `user_skins`' equivalent shape.
- [ ] `src/server/lib/tricks.ts`: `equipTrick(db, userId, trickId)`,
      mirroring `lib/skins.ts`'s `equipSkin()`.
- [ ] `src/server/routes/tricks.ts`: `POST /api/tricks/:id/equip`.
- [ ] `catalogue()` in `lib/tricks.ts` returns `equipped` per row (plus the
      always-present default trick's effective-equipped fallback logic).

### Phase 3: Client — trick equip wiring — **haiku**
- [ ] `client/src/net.ts`: `Trick.equipped`, `equipTrick(id)`.
- [ ] `client/src/main.ts:1172`: replace random draw with equipped-trick
      selection; remove the dead random-draw code.

### Phase 4: Keystroke indicators — **sonnet**
- [ ] Locate or add the shared token→glyph helper (`trick.ts` or similar).
- [ ] Wire it into the HUD prompt (refactor only if needed), `shop.ts`'s
      trick row, and cosmetics' new trick row.

### Phase 5: Cosmetics — trick equip UI — **haiku**
- [ ] `client/src/cosmetics.ts`: tricks section mirroring the skins section
      (list owned tricks + default, keystroke indicator per row,
      equip/equipped button wired to `equipTrick`).

### Phase 6: Shop layout rework — **sonnet**
- [ ] `index.html`: horizontally-scrollable `.shop-scroll` containers for
      skins and tricks, `.shop-card` styling, keyframe animations for
      swatch-pulse (skins) and glyph-cycle (tricks).
- [ ] `shop.ts`: update rendering to emit cards into the new scroll
      containers; keep existing buy/unlock logic unchanged.

### Phase 7: Interactive tutorial — **sonnet**
- [ ] `client/src/tutorial.ts`: step-sequence overlay state + spotlight/
      caption rendering + Next/Skip.
- [ ] `index.html`: overlay DOM (checked against `spec/README.md` first),
      "how to play" button on the title screen.
- [ ] Hook auto-start into first-ever username creation; `localStorage`
      seen-flag; manual relaunch from the title-screen button.
- [ ] Steps cover: title controls, crew, shop (skins + tricks), cosmetics
      (equip), HUD/pause.

### Phase 8: Sun shape fix — **sonnet**
- [ ] `client/src/sun.ts`: make `SUN_WIDTH`/`SUN_HEIGHT` equal; retune
      `SUN_FORWARD_OFFSET`/`SUN_HEIGHT_OFFSET` if framing looks off.
- [ ] Grep for other `SUN_WIDTH`/`SUN_HEIGHT` references before changing.

### Phase 9: Verification — **haiku** (typecheck/test/server test), **sonnet** (browser smoke test)
- [ ] `pnpm typecheck` and `pnpm test` stay green. — **haiku**
- [ ] New server test for the trick equip route, mirroring
      `spec/skins.test.ts`'s equip coverage: equip succeeds and persists,
      equipping an unowned/unknown trick 404s, 401 signed-out. — **haiku**
- [ ] Browser smoke test: equipping a trick in cosmetics changes which trick
      plays on the next ramp hit, every time (no more randomness); shop and
      cosmetics trick rows show the correct keystroke sequence; shop's two
      sections scroll horizontally with visible card previews animating;
      a brand-new account sees the tutorial automatically, Skip/Next both
      work, and the "how to play" button replays it later; the sun renders
      as a circle, not an oval, with no horizon-clipping regression.
