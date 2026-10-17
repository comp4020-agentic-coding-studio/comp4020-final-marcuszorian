# nightly build: build plan

Living task list. The previous plan (the three-lane arcade overhaul, C9's
real-time ghosts, the coin economy, and crews) has shipped — its reasoning
lives in `doc/adr/0004` through `0011` and in git history, not here. This
plan starts the next piece of work clean: a title screen, a pause menu, one
combined settings panel, and three dedicated destinations (crew, shop,
cosmetics) that the current corner-widget garage gets split into. Not a spec
(that's the course's), not a decision record (those are in `doc/adr/`).

---

## 1. Overview & goals

Today the game drops you straight onto the road, with every other feature —
sound/effects toggles, the leaderboard, the garage, the day archive — living
as corner widgets layered over live gameplay. That made sense while those
features arrived one at a time, but it means there is no front door: nothing
tells a new player what this game *is* before asking them to survive it, and
a returning player has no calm moment to check their crew or spend coins
without the road already scrolling under them.

This plan adds that front door — a title screen — and uses it to give four
things a proper home: starting a run, joining a crew, the coin shop, and
cosmetics. It also adds the pause a race currently has no way to request, and
collapses the two existing settings pills into one menu available everywhere.

**What stays invariant:** the vaporwave visual language (`doc/adr/0003`), the
lane mechanics and collision model (`doc/adr/0004`), the realtime ghost feed
(`doc/adr/0005`), the day archive's read-only-past rule (`doc/adr/0006`), the
leaderboard's ranking (`doc/adr/0009`), and the coin/crew economics
(`doc/adr/0010`, `0011`). Nothing here touches a route, a table, or a game
rule — it is a client-side reorganization of how those existing things are
reached. Nothing in it requires a new ADR under `CLAUDE.md`'s own rule, which
is about changing the stack, storage, or data model; this changes none of the
three.

---

## 2. Requirements

### Boot flow
- Identity is resolved exactly as today (`GET /api/me`), but now it gates
  *the title screen*, not just the username modal. A new user sees the
  username prompt first and nothing else — no title screen behind it, no
  road visible — and only once an account exists does the title screen
  render. A returning user (the request already has a valid cookie) goes
  straight to the title screen, with no flash of the prompt.

### Title screen
- **A close-up of the player's car**, in its currently equipped trim,
  filling the **left half** of the screen. Camera at 45° from the car's
  front, **level with the car** (not elevated — a hood-height shot, not a
  chase-cam angle), **headlights lit**. This reuses the existing car model
  and scene rather than a second renderer: see Phase 2.
- **The same background the rest of the game runs on** — the sky gradient,
  the banded sun, the fog — so the title screen reads as the same place the
  road is, not a separate menu scene. *My call, flagged for review:* the
  scrolling ground grid and wireframe mountains are left out of this shot.
  Both are built to scroll past a moving camera, and a title screen's camera
  never moves; a static grid reads as an error, not a design choice, and the
  sky + sun + fog alone already carries the palette.
- **Four buttons, stacked vertically, filling the right half**, top to
  bottom: **Start Race**, **Join Crew**, **Shop**, **Cosmetics** — the exact
  order and wording requested.
- **The day stepper moves here** from the race HUD (see "Day archive
  relocation" below) — shown near Start Race, defaulting to today.
- A small readout of who you are and your coin balance. Not explicitly
  requested, but without it both are invisible until you open Shop, and
  `/api/me` already returns both for free.
- **A settings gear, bottom-right**, present here and on every other screen —
  see "Settings" below.

### Pause (Escape during a run)
- Escape pauses a race **only while one is actually in progress** — not
  while the crashed panel is showing (there is no run to pause), not while
  the username modal is open, and not on the title screen or any of the
  three dedicated screens, where Escape does nothing new.
- Paused: the simulation stops advancing (distance, obstacles, the speed
  ramp) and the engine note settles, the same way it already does whenever
  `running` is false; the camera and scene keep rendering so the frame
  doesn't look frozen mid-glitch. An overlay offers **Resume** and **Home**.
- **Resume** unpauses; **Escape again** while paused does the same thing,
  so the key is a toggle, not a one-way door.
- **Home discards the run** — no `postRunEnd` call — and returns to the
  title screen. This matches your answer and the existing rule that only a
  crash sets a best run of the day; quitting early has never counted, and a
  paused run that goes Home shouldn't start counting now. The run cannot be
  resumed after Home; pressing Start Race again begins a fresh one.

### Settings (one menu, not two pills)
- A single gear icon, bottom-right, replaces the current `#fxToggle` and
  `#soundToggle` pills and is visible across every screen this plan adds —
  title, racing, paused, and all three dedicated screens.
- Opens one small panel listing both existing toggles — **reduce effects**
  and **mute sound** — with no new settings added. Same underlying state
  (`postfx.setActive`, `audio.setMuted`) as today, just one surface instead
  of two.
- Closing it (an explicit close control, or clicking outside) never pauses
  or unpauses a race by itself. *My call:* if it's open and Escape is
  pressed during a race, Escape closes the settings panel first rather than
  also toggling pause underneath it — one keypress, one effect.

### Crew / Shop / Cosmetics — three dedicated screens, not corner widgets
Per your answer, each is a full screen reached from its title-screen button,
with a Back control returning to the title screen. None are reachable mid-
race; pausing offers Resume or Home, not a side door into the shop. Each
screen is backed by exactly the server calls the current garage widget
already uses (`net.ts`'s `getSkins`/`unlockSkin`/`equipSkin`/`createCrew`/
`getMyCrew`/`joinCrew`) — nothing server-side changes.

- **Join Crew**: create a crew (name, optional max joins / expiry) or, once
  in one, see its name, member count, and a copyable invite link — exactly
  what the garage's crew section does today, given its own screen.
- **Shop**: the skin catalogue and your coin balance, with a buy action per
  unowned skin. This screen is about *acquiring* skins — it does not equip
  anything.
- **Cosmetics**: your owned skins (the free default included), with a
  pick-to-equip action. Equipping **live-updates the title screen's hero car**
  — the two share one scene and camera, so a trim change is visible the
  instant it's picked, with no need to start a run to see it.

### Day archive relocation
- The `#day` stepper leaves the always-on race HUD and moves to the title
  screen, next to Start Race.
- A run always plays the day selected on the title screen at the moment
  Start Race is pressed; the existing bounds (`ARCHIVE_EPOCH`,
  `canGoBack`/`canGoForward`) are unchanged, just relocated.
- **Consequence worth stating plainly:** switching days *during* a race goes
  away. Today the HUD lets you change days mid-run, which quietly restarts
  the run on the new day's track; once the stepper only exists on the title
  screen, changing days means going Home first. This is a real behavioural
  simplification, not an oversight.
- *My call:* the title screen's hero shot and ambience pick up the selected
  day's archive age (`postfx.setArchiveAge`, `audio.setArchiveAge`), the same
  way the road already does — so stepping back a few weeks makes the title
  screen itself look and sound like the worn tape the archive argues it is,
  before you've even pressed Start.
- The leaderboard panel's own day-scoping (crew/global tabs, ADR 0011) is
  untouched; it still reflects whatever day is currently selected.

---

## 3. Decisions made without asking, flagged for review
Called out here rather than buried in the phases, so any of them is easy to
redirect:
1. No grid/mountains behind the title hero shot — sky, sun, and fog only.
2. Camera sits 45° off the car's **passenger side** (so the driver's-side
   headlight and the car's profile both read in frame) — arbitrary between
   left and right; easy to flip.
3. The existing emissive headlight meshes (already visible whenever the car
   isn't ghostly) are judged sufficient for "headlights on" in the hero shot,
   with **two small `SpotLight`s added at the headlight positions, active
   only while the title or Cosmetics screen is shown** — a real light pool
   sells a hero shot in a way the emissive glow alone doesn't, and it's an
   acceptable cost specifically because it's never active during a race,
   where the 256MB/low-GPU budget actually bites.
4. Settings takes priority over pause on a single Escape press when both are
   live.
5. A username/coin readout on the title screen, though not requested.
6. No new ADR — explained in §1.

---

## 4. Hard constraints
1. **Zero new dependencies** — the hero shot, pause, and settings menu are
   built from the `three@0.182.0` and DOM primitives already in use.
2. **Every DOM id `spec/` or the course's own invariants rely on stays
   present and functional** (`#score`, `#crashed`, `#restart`, etc.) —
   relocating an element in the layout is fine; renaming or removing one that
   a test or the harness depends on is not. Check `spec/README.md` and
   `spec/invariants.test.ts` before moving anything.
3. **No server-side change.** This is entirely client-side; no migration, no
   new route, no change to realtime, coins, or crew scoping.
4. **Nothing this plan touches may regress**: the `e.repeat` lane-shift
   guard, ghost rendering and the realtime push, coin settlement, or crew-
   scoped ghosts/leaderboard — none of which this plan has a reason to touch.
5. **`/` (200) and `/readme/` contract tests keep passing.**

---

## 5. Implementation phases

### Phase 1: App shell / screen state
- [x] Introduce an explicit screen state — `title | racing | paused | crew |
      shop | cosmetics` — governing which full-screen section is visible and
      whether the simulation advances. `running` continues to describe "is a
      run alive", separately from whether it's currently paused.
      *(`screens.ts`; the enum also carries `boot` and `username`.)*
- [x] Hold the title screen, not just the username modal, behind identity
      resolution (`GET /api/me`).
- [x] Wire Escape: no-op outside `racing`/`paused`; closes an open settings
      panel if one is open; otherwise toggles `racing` ↔ `paused`.

### Phase 2: Title screen & hero shot
- [x] `index.html`: a `#titleScreen` section — the left half left clear over
      the existing `<canvas>` (no second renderer), the right half holding
      the four buttons, the day stepper, and the username/coin readout.
- [x] A dedicated camera placement (`hero-shot.ts`) computing the
      45°-from-front, car-height framing described in §2 and §3.
- [x] The two headlight `SpotLight`s from §3, created once and toggled
      active/inactive with the screen rather than recreated each time.
- [x] Background: reuse `createSky`/`createSun`/`palette` exactly as the race
      does; grid and mountains omitted per §3.
- [x] Start Race transitions to `racing` and calls the existing `resetRun()`
      for whichever day the stepper currently shows.

### Phase 3: Pause
- [x] Freeze the physics/scoring advance while `screen === "paused"`; keep
      rendering the frame (camera, scene, postfx) so pausing doesn't look
      like a crash.
- [x] Pause overlay: Resume and Home.
- [x] Home discards the run (no `postRunEnd`) and returns to `title`.
- [x] The engine audio settles while paused, the same way it already does
      whenever `running` is false (`audio.setDriving(false)`).

### Phase 4: Settings menu
- [x] One gear icon, bottom-right, present on every screen this plan adds.
- [x] One panel combining the current `fxToggle`/`soundToggle` behaviour
      one-for-one; the two standalone pills are removed.
- [x] Confirm it's usable mid-race without pausing anything by itself.

### Phase 5: Crew / Shop / Cosmetics screens
- [x] Split `garage.ts` into three screen controllers — `crew-screen.ts`,
      `shop.ts`, `cosmetics.ts` — each backed by the `net.ts` calls the
      current garage widget already makes. No new server calls.
- [x] Join Crew screen: create/view/copy-invite, as the garage's crew section
      does today, given a full screen and a Back control.
- [x] Shop screen: catalogue, balance, buy — acquisition only.
- [x] Cosmetics screen: owned skins, equip — wired to repaint the same hero
      car the title screen renders, live.
- [x] Each screen's Back returns to `title`.

### Phase 6: Day archive relocation
- [x] Move the `#day` markup and its stepper logic (`DaySelector`) from the
      race HUD onto the title screen.
- [x] Drop in-race day switching — changing days is a title-screen action now.
- [x] Apply the selected day's `archiveAge` to the title screen's look and
      sound, per §3's call.

### Phase 7: Verification
- [x] `pnpm typecheck` clean.
- [x] `pnpm test` passing (53/53) — client-only, so no `spec/` behaviour
      changed. The one spec edit was an import path: `skinColor` moved from
      the deleted `garage.ts` to the new `skins.ts`.
- [x] `pnpm check:evidence` passing.
- [x] Browser smoke test, all of it, in a real headless Chrome with software
      WebGL: a new account sees the username prompt alone (title and HUD both
      hidden); the title screen then shows the car on the left, headlights
      lit, with the four buttons in the stated order on the right; Start Race
      begins the day the stepper shows; Escape pauses (distance verifiably
      frozen) and Escape again resumes; Home from pause leaves **0 rows in
      `/api/ghosts`** for that player, so the run really is discarded; a
      *crash* still records (rank 11, "YOU" on the panel); all three
      destinations open and Back returns; the gear works from every screen
      and Escape closes it without touching pause. Screenshotted at 1280×800
      and at 390×844.

### What shipped differently from the above
Recorded rather than quietly absorbed, same habit as the ADRs:

- **The hero shot turns the CAR, not the camera.** The plan said to orbit the
  camera to 45°. Done that way, the two requirements fight: orbiting to put
  the nose in view swings the camera round to the car's side, and offsetting
  the look-target to push the car left rotates it further. Three successive
  attempts rendered a flat profile before the geometry was right. The camera
  now sits square in front and `HERO_TURN` yaws the car; the left-half
  framing is a `setViewOffset` frustum shift, which moves the frame without
  moving or rotating the camera at all.
- **`clearHeroFraming()` exists because `setViewOffset` is sticky.** Left
  set, the entire race renders shifted off-centre — and `resize()`
  recomputing `camera.aspect` does *not* clear it.
- **A hero key light was added** (`createHeroKeyLight`), beyond the plan's
  two spotlights. The scene's existing rim light is aimed for a car seen from
  behind at speed; at a front-quarter close-up it left the hull reading as a
  hole with wireframes floating in it. Like the headlights, it is off during
  a race.
- **`GhostLayer.setVisible()` was added.** Ghosts park at their crash
  distances along the road, and the hero camera looks back down that road
  from 6m in front of the start line — so a busy day stacked a wall of other
  players' cars directly behind the portrait. Hidden, not unsubscribed: they
  keep streaming in, so a race starts with them already in place. Found by
  screenshotting, not by reasoning.
- **`CameraRig.reset()` was added**, so starting a race cuts to the chase
  camera instead of smoothly flying there from the portrait over half a
  second with the run already counting distance.
- **The crashed panel grew a Home button.** Without one, a crash could only
  be followed by another run — there was no way back to the title screen from
  the state you reach most often.
- **`skins.ts` was extracted** rather than having Shop import from Cosmetics:
  both need the swatch/colour helpers, and the palette-key rule (ADR 0010)
  belongs with neither one in particular.
- **Portrait gets its own framing** (pulled back 1.5×, lifted slightly)
  because the same distance frames far tighter in a narrow viewport — on a
  phone the car filled the screen and ran under the logo.
