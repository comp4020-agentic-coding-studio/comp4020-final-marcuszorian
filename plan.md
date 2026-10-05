# drift archive → 3-lane arcade runner: build plan

Living task list for the 3-lane arcade runner mechanical overhaul. Supersedes the previous visual-direction plan; not a spec (that's the course's), not a decision record (those are in `doc/adr/`).

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
- [ ] Write `doc/adr/0004-discrete-three-lane-runner.md` superseding ADR 0002 before touching code.
- [ ] Document context, alternatives ruled out, and ghost snapping consequences.

### Phase 2: Track & Obstacle Architecture (`client/src/track.ts`)
- [ ] Flatten road centerline (`centerXAt = 0`, `driftFor = 0`).
- [ ] Define discrete lane width and lane centers (`-laneWidth`, `0`, `+laneWidth`).
- [ ] Implement catalogue of 15–20 curated obstacle patterns with strict solvability (1 or 2 blocked lanes, never 3).
- [ ] Implement seeded deterministic pattern sequencer that loops continuously.
- [ ] Implement dynamic longitudinal gate spacing scaling with speed.
- [ ] Update obstacle geometry and materials to lane-filling rectangular red neon hazard barriers.
- [ ] Update road surface shader with two dashed neon divider lines.

### Phase 3: Discrete Car Physics & Controls (`client/src/car.ts`, `client/src/camera-rig.ts`)
- [ ] Add discrete lane state (`currentLane`, `targetLane`, `transitionTimer`).
- [ ] Implement single-tap keydown handling (ignoring `e.repeat`).
- [ ] Implement ~120ms smooth slide interpolation between lanes.
- [ ] Continuous distance-based speed ramp curve.
- [ ] Continuous bounding-box collision detection against lane-filling barriers during transitions.
- [ ] Link vehicle roll/banking to slide velocity.

### Phase 4: Ghost Backward Compatibility (`client/src/ghosts.ts`)
- [ ] Snap legacy continuous `lane` floats to the nearest discrete lane index (`-1`, `0`, `+1`).
- [ ] Update ghost meshes to match lane width and visual styling.

### Phase 5: Verification & Polish
- [ ] `pnpm typecheck` clean (0 errors).
- [ ] `pnpm test` passing (8/8 tests).
- [ ] `pnpm check:evidence` passing.
- [ ] Browser smoke test: verify lane responsiveness, collision accuracy, obstacle solvability, speed progression, and ghost rendering.
