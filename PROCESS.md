# Process overview

How you got from the brief to the harness, agentic workflow and stack behind
this app. The
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/#what-you-submit)
says what it covers and how long it runs.

## Decisions, before code

Before letting the agent touch any application code, I established the architectural constraints and recorded them as Architectural Decision Records. The brief required a multi-user web application running continuously on a single 256MB Fly VM with an attached SQLite volume at `/data`, proof-of-life persistence for Crit 8, and low-latency broadcast for Crit 9.

Rather than defaulting to Astro (the course default) or blindly accepting whatever framework the agent picked first, I had three parallel research passes evaluate Node/Express, Astro, Django+Channels, and Phoenix LiveView against our specific constraints. That research exposed critical failure modes: Astro still lacks an official WebSocket API (an unmerged RFC since September 2023), requiring a custom Node wrapper where Astro adds nothing to game networking and idles at 80–150MB; Phoenix LiveView's server-rendered DOM diffing clashes directly with a client-side WebGL game loop; and Django Channels has documented async-sync ORM pitfalls and Daphne memory leaks on 256MB. Node.js + Express + better-sqlite3 with Three.js proved to be the most dependable, lightweight architecture. Crucially, I designed a minimal seam in `src/server/lib/events.ts` (`scoreChanged()`) where WebSocket broadcast can be dropped in for C9 without restructuring anything else.

For the data model, I rejected both a single rolling high score (which makes past days meaningless) and ephemeral daily wipes (which discard history). In ADR 0002, I locked `best_runs` to a composite primary key of `(user_id, track_seed)` where `track_seed` is the UTC date. This transformed the mechanic: a day became a permanent, revisitable space in an archive. Codifying ADR 0001 and 0002 upfront prevented the agent from hallucinating schema changes or reaching for heavy external dependencies.

- [`67140e1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/67140e1) —
  `doc/adr/0001-stack.md`, `doc/adr/0002-daily-seeded-archive.md`
- [`357f8d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/357f8d1) —
  decision-record convention and the week's plan

## C8: server, game, first deploy

I directed the agent to build the backend first: minimal Express routing, SQLite PRAGMA configuration (WAL mode, busy timeouts), and migration execution at container startup. As documented in `fly.toml`, Fly release machines run without a volume attached, so running migrations via Fly's `release_command` would silently initialize an empty ephemeral database. Boot-time execution in the Docker `CMD` was essential.

To verify persistence and day isolation, I directed the creation of HTTP integration tests in `spec/` (`ghosts.test.ts`, `days.test.ts`), verifying that runs save, reappear on the correct day seed, and reject future dates. We then built the Three.js driving prototype: deterministic track generation via a hand-rolled `mulberry32` PRNG in `track.ts`, lane-offset vehicle physics in `car.ts`, and ghost polling in `ghosts.ts`.

The crucial intervention came during manual browser smoke-testing. Headless `curl` calls and Vitest specs were completely green, but when I rendered the game in a browser via Chromium/Playwright, I caught two major bugs that automated tests missed entirely:
1. **The username modal never closed**: Author CSS had `.modal { display: flex }`, which has higher specificity than the browser's user-agent stylesheet rule for `[hidden] { display: none }`. The attribute toggled correctly in the DOM, but the modal stayed visibly frozen on screen. I resolved this by adding an explicit `.modal[hidden] { display: none }` author override.
2. **The road was invisible**: The triangle index winding on the procedural road mesh pointed front faces downwards away from the camera, causing Three.js to cull the entire road. I fixed this by setting `side: THREE.DoubleSide` on the road material, which also made rendering resilient against winding flips caused by curve drift signs.
3. **Mobile double-submission**: Testing on mobile revealed that quick double-tapping fired duplicate registration requests, producing a confusing 409 "username is taken" error on the second request for the user's own name. I had the agent disable submit while in-flight and treat 409 as idempotent when the client token is already stored.

We deployed to Fly and verified end-to-end against the real persistent volume.

- [`c4b1084`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/c4b1084) —
  server: accounts, run-end, ghosts, days, `/readme/`
- [`1e290d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/1e290d1) —
  spec: persistence and day-isolation checks
- [`b2f2009`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/b2f2009) —
  the game: seeded road, car physics, ghosts, day selector
- [`5a6c184`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/5a6c184) —
  first deploy confirmed live against the real Fly volume
- [`9f280ff...9b681f8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/9f280ff...9b681f8) —
  two real bugs found only by actually rendering the page, fixed

## The visual direction (neon/vaporwave overhaul)

Rather than adding generic polish, I directed an overhaul grounded in the philosophical argument of `README.md`: the game is an archive of past presences, and ghosts represent "lost futures" that didn't arrive (Mark Fisher's hauntology). Synthwave/outrun provided the driving aesthetic—a dark `#0D0221` base ensuring high HUD contrast and neon speed cues—while vaporwave pastel lavender was reserved specifically for ghost cars to visually separate them from racing opponents.

I established rigid boundary conditions in `plan.md` before the overhaul began:
- **Track geometry is frozen**: `(seed, distance) → road` is a pure mathematical contract. Materials, post-processing, and shaders could change, but moving the centerline would retroactively invalidate recorded ghost positions.
- **Zero new dependencies**: Leveraging Three.js's vendored `examples/jsm` addons (`EffectComposer`, `UnrealBloomPass`, `OutputPass`, `ShaderPass`, `RGBShiftShader`, `FilmShader`) rather than pulling in external post-processing libraries.
- **Shaders as template strings**: Kept inline to avoid configuring esbuild loaders or breaking container builds.

Across the four implementation phases, I repeatedly redirected the agent and tuned effects visually:
- **Refused arcade leaderboards**: Overruled the aesthetic's pull toward arcade high-score tables to preserve our core principle that ghosts are things you drive past, not ranks you look up.
- **Corrected sky horizon fade**: The agent's first sky shader produced a flat 20° orange block below the horizon due to an angular constant bug (`0.35` radians); I had it retuned to a thin, seamless fade into the void.
- **Bloom and sun tuning**: The initial bloom pass washed out the player's magenta car into pale pink, and the banded sun was blown out into a solid white disc at 2.6× intensity. I dialed the sun down to 150×95 at 1.05× so gradient bands and cutouts remained crisp.
- **Archive aging**: In Phase 4, we implemented `archiveAge(seed)` in `days.ts` driving chromatic aberration and grain in `postfx.ts`. Visiting an older day feels like loading a worn VHS tape, directly uniting the visual aesthetic with the archive mechanic.
- **Themed `/readme/`**: Styled the raw markdown route in `src/server/routes/readme.ts` to match the palette, ensuring the marker reads our argument in the game's native visual language.

- [`5935410`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/5935410) —
  `plan.md`: the visual-direction plan
- [`216b3b5...f98b15d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/216b3b5...f98b15d) —
  the four phases (palette/sky/bloom; grid/sun/mountains; HUD/readme theming;
  camera feel/ghosts/crash feel) plus `doc/adr/0003-visual-direction.md`

## What I'd flag to a marker

- **Deliberately deferred**:
  - Real-time WebSocket broadcasting is deferred to C9. Polling every 60–120s satisfies C8 proof-of-life, and the `scoreChanged()` seam in `src/server/lib/events.ts` stands ready for the socket broadcaster.
  - Audio (engine rumble, collision sounds, synth soundtrack) is deferred to keep the build scoped; Web Audio can be added later without external packages.
  - Mobile touch controls are omitted. The responsive CSS and viewport scale down to mobile screens cleanly, but driving controls currently expect keyboard input (arrow keys / WASD).
- **Client test boundary**: The client code in `client/src/` has no automated WebGL unit test suite. As documented in `plan.md`, headless API integration tests in `spec/` verify data invariants, while manual browser smoke-testing and screenshots served as the verification gate for graphics and gameplay.
- **Rough edges & agent corrections**:
  - The agent initially culled road chunks and ghosts with `scene.remove()` without calling `.dispose()`. While harmless with primitive shared materials, per-chunk shader materials and per-ghost materials caused memory leaks. I had the agent add explicit `.dispose()` calls for geometry, materials, and ghost label DOM nodes upon removal in Phase 4.
  - Typography relies on system fonts and CSS styling rather than external Google Fonts to eliminate external CDN dependencies and avoid Content Security Policy complications.
  - An interactive "Reduce Effects" toggle and `prefers-reduced-motion` queries were added to protect low-spec machines and ensure WCAG compliance (disabling scanlines, flicker, and trauma² camera shake).
