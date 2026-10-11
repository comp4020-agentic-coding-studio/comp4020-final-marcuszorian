# nightly build: build plan

Living task list. Sections 1–5 are the 3-lane arcade runner mechanical overhaul; section 6 is the C9 real-time work. Supersedes the previous visual-direction plan; not a spec (that's the course's), not a decision record (those are in `doc/adr/`).

---

## 1. Overview & Core Philosophy

This overhaul pivots the game from continuous analogue steering with curve drift into a crisp, high-speed **three-lane arcade runner** (in the spirit of *Subway Surfers* and *Audiosurf*).

### What Stays Invariant
* **The Hauntological Archive**: The visual aesthetic (dark `#0D0221` base, ACES tonemapping, bloom, banded sun, ground grid, wireframe mountains, and archive aging) remains intact.
* **Presence over Leaderboards**: Traces remain objects you drive past in 3D space, not numbers on an abstract ranking table.
* **Deterministic Daily Seed**: Every UTC date generates an identical, reproducible track configuration shared by all clients.
* **Zero New Dependencies**: Continues to rely strictly on `three@0.182.0` vendored addons and hand-rolled PRNGs.

---

## 2. Requirements Specification

### Lane Mechanics & Input
* **Three Discrete Lanes**: Left (`-1`), Center (`0`), and Right (`+1`).
* **Input Handling**: Strict single-tap triggers (`Left` / `A` and `Right` / `D`). Each keypress shifts exactly one lane; holding the key down does not repeatedly shift lanes (`e.repeat` is ignored).
* **Movement Feel**: A fast, smooth slide (~120ms lerp) between lane centers.
* **Active Hitbox**: The vehicle hitbox remains active during the slide (clipping an obstacle mid-transition triggers a crash). The car model dynamically banks/rolls in the direction of the slide.

### Road & Visual Layout
* **Centerline**: Straight road (`x = 0` for all distances); road curvature drift is eliminated.
* **Lane Dividers**: Two dashed neon divider lines splitting the road surface into three distinct lanes, plus glowing cyan outer road boundaries.
* **Scenery Parallax**: Ground grid, wireframe mountains, and banded sun maintain their forward scrolling and horizon anchoring.

### Obstacle Generation & Looping Sets
* **Strict Solvability**: Every obstacle row contains either 1 or 2 blocked lanes—**never all 3**, guaranteeing at least one open lane.
* **Curated Pattern Library**: A catalogue of 15–20 distinct obstacle gate patterns (e.g., single barriers, double-lane clamps, alternating slaloms, zig-zags).
* **Seeded Looping Sequence**: The UTC day seed deterministically shuffles and sequences these patterns into an extended playlist that repeats once completed.
* **Lane-Filling Barriers**: Obstacles are rendered as rectangular red neon hazard barriers spanning the full lane width.

### Speed Scaling & Reaction Window
* **Continuous Speed Ramp**: Velocity smoothly accelerates with distance from a base cruising speed toward a challenging max ceiling.
* **Dynamic Reaction Spacing**: The longitudinal distance between consecutive obstacle gates expands slightly with speed, preserving a fair human reaction window (~300–400ms minimum) rather than becoming physically impossible.

### Ghost Compatibility
* **Coordinate Snapping**: Past runs recorded with continuous float lane coordinates snap to the nearest discrete lane (`-1`, `0`, or `+1`), allowing all historical ghosts to sit cleanly within lanes without resetting the database.

---

## 3. Hard Constraints

1. **Deterministic Reproducibility**: `(seed, distance) → obstacles` must remain a pure function so all clients and ghosts agree on placements.
2. **Strict Solvability**: Obstacle generator must assert that no row ever spawns 3 obstacles.
3. **Zero New Dependencies**: No external animation or physics libraries; implement the ~120ms slide with a simple delta-time lerp.
4. **Shaders as Template Strings**: Maintain inline GLSL strings without introducing custom bundler loaders.
5. **Preserve Harness Invariants**: Keep all required DOM IDs in `client/index.html` intact (`#score`, `#crashed`, `#restart`, etc.), and maintain `/` (200) and `/readme/` contract tests.

---

## 4. Implementation Phases

### Phase 1: Architectural Decision Record
- [x] Write `doc/adr/0004-discrete-three-lane-runner.md` before touching code. It supersedes
      nothing: ADR 0002's data model is untouched, and ADR 0003 already said a change
      touching the centerline should be a new record. Corrected from the original
      "superseding ADR 0002".
- [x] Document context, alternatives ruled out, and ghost snapping consequences.

### Phase 2: Track & Obstacle Architecture (`client/src/track.ts`)
- [x] Flatten road centerline (`centerXAt = 0`, `driftFor = 0`).
- [x] Define discrete lane width and lane centers (`-laneWidth`, `0`, `+laneWidth`).
- [x] Implement catalogue of 15–20 curated obstacle patterns with strict solvability (1 or 2 blocked lanes, never 3).
- [x] Implement seeded deterministic pattern sequencer that loops continuously.
- [x] Implement dynamic longitudinal gate spacing scaling with speed.
- [x] Update obstacle geometry and materials to lane-filling rectangular red neon hazard barriers.
- [x] Update road surface shader with two dashed neon divider lines.

### Phase 3: Discrete Car Physics & Controls (`client/src/car.ts`, `client/src/camera-rig.ts`)
- [x] Add discrete lane state (`currentLane`, `targetLane`, `transitionTimer`).
- [x] Implement single-tap keydown handling (ignoring `e.repeat`).
- [x] Implement ~120ms smooth slide interpolation between lanes.
- [x] Continuous distance-based speed ramp curve.
- [x] Continuous bounding-box collision detection against lane-filling barriers during transitions.
- [x] Link vehicle roll/banking to slide velocity.

### Phase 4: Ghost Backward Compatibility (`client/src/ghosts.ts`)
- [x] Snap legacy continuous `lane` floats to the nearest discrete lane index (`-1`, `0`, `+1`).
- [x] Update ghost meshes to match lane width and visual styling.

### Phase 5: Verification & Polish
- [x] `pnpm typecheck` clean (0 errors).
- [x] `pnpm test` passing (8/8 tests).
- [x] `pnpm check:evidence` passing.
- [x] Browser smoke test: verify lane responsiveness, collision accuracy, obstacle solvability, speed progression, and ghost rendering.

---

## 6. Real-time ghosts (C9)

A run that ends anywhere reaches every open session watching that day inside a
second, with no reload. The behavioural decision — a run is private while it
happens, public once it ends and only if it improved — is
`doc/adr/0005-realtime-ghosts.md`.

Note on "Zero New Dependencies" (§3 constraint 3): that constraint is about the
client — no animation or physics library for work a few lines can do. `ws` is a
server dependency that ADR 0001 named a month ago when it chose Node over Astro
precisely to keep it available. Adding it is the plan being followed, not
broken.

- [x] `doc/adr/0005-realtime-ghosts.md`: the decision, the two options refused, what it costs.
- [x] `events.ts`: turn the `scoreChanged()` no-op into a real in-process topic. `runs.ts` unchanged.
- [x] `lib/live.ts`: `ws` server at `/live`, per-connection day subscription, heartbeat to reap dead sockets.
- [x] `index.ts`: explicit `http.Server` so the socket has something to attach to.
- [x] `net.ts`: `LiveFeed` — one socket, re-subscribe on day change, jittered reconnect backoff.
- [x] `ghosts.ts`: render from push; polling demoted to the fallback while the socket is down.
- [x] `spec/realtime.test.ts`: the spec line under test, plus cross-day isolation, backfill, and improvement-only.
- [x] Verify in two real browsers with separate cookie jars, not two tabs of one.
