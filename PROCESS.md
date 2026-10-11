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

## The three-lane overhaul

The driving model from C8 — continuous analogue steering on a centerline that drifted a seeded amount per chunk — got worse as the speed ramp did its job. Two tasks competed for the same two keys (correcting against drift, and dodging), difficulty was incoherent because obstacles sat at a random continuous `x`, and nothing in the generator could even state "a way through exists". I directed a pivot to three discrete lanes with single-tap input, recorded in `doc/adr/0004-discrete-three-lane-runner.md`.

Three corrections I made to my own plan during this tranche:

- **The plan named the wrong record to supersede.** `plan.md` said ADR 0004 would supersede ADR 0002. The agent pushed back: ADR 0002 is the *data model* (`best_runs` keyed by `(user_id, track_seed)`), which a lane change leaves entirely intact, and ADR 0003 had already prescribed the correct form — "a future change that *does* need to touch the centerline is a new ADR". I corrected the plan rather than let the ADR trail record a decision that was never made.
- **Solvability is asserted, not hoped for.** I required `patternIsSolvable` to propagate the reachable lane set row by row under "one shift between rows". Two staircase patterns in the first draft of the catalogue forced a two-lane move between adjacent rows and failed the check; both were replaced. The invariant is the point — a hand-written catalogue without one is just twenty chances to ship an impossible gate.
- **The speed ramp had no ceiling.** `plan.md` asked for one; the existing `sqrt` curve was unbounded and passed 100 m/s by 11km, which no reaction window makes fair. Capped at 52 m/s, with gate spacing derived from speed so the reaction window holds at a 0.36s floor.

Verification was a headless Chrome harness driven over the DevTools protocol — no new project dependency. It confirmed all 20 patterns solvable and no row blocking three lanes across 8km, every nominally open lane actually clearing every barrier, ten `repeat: true` keydowns correctly ignored, and two single taps clearing the 70m and 83m gates.

- [`7c18e4e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/7c18e4e) —
  the overhaul and `doc/adr/0004-discrete-three-lane-runner.md`

## C9: real-time, and the three bugs hiding behind it

The socket itself was nearly free, and deliberately so. ADR 0001 chose Node over Astro a month earlier *specifically* to keep `ws` available, and left `scoreChanged()` as a no-op seam. Cashing it in required no change to `runs.ts` at all — the clearest payoff in this project from deciding before coding.

The decision C9 actually asks for is one level up, and it is `doc/adr/0005-realtime-ghosts.md`: **a run is private while it happens and public the moment it ends, and only if it improved.** I refused live car positions — the obvious crowd-pleaser, and the option my pod should argue for — on `README.md`'s own terms: a ghost means "someone else was right here", past tense. A car moving beside you is an opponent, and this game has no leaderboard on purpose. I chose WebSocket over the simpler SSE for one concrete reason: a client must say *which day* it is watching, and that changes while the page is open, which over SSE is a new `EventSource` per day change.

**What actually consumed the week was verifying it.** Two browser tabs failed to show propagation, and my first diagnosis was wrong: both tabs shared one cookie jar, so they were the same player. Driving two genuinely separate browsers then uncovered three bugs chained behind one another:

- **Auth, pre-existing since C8.** `setAuthCookie` sets `httpOnly`, so `document.cookie` can never hold the token, so `hasAccount()` always returned `false`, so `if (hasAccount()) postRunEnd(...)` never fired. **No crash in a real browser had ever saved a run** — every ghost in the database had been written by the test suite. Fixed by keeping `httpOnly` and adding `GET /api/me`: the browser asks the server who it is instead of guessing.
- **NaN, unmasked by fixing the above.** `requestAnimationFrame` reports the timestamp of the frame already in flight, which can predate the `lastTime` set when `main.ts` finishes evaluating. The resulting negative `dt` drove distance below zero and `speedAt`'s `sqrt` turned it to `NaN` for the rest of the session. The always-visible username modal had been concealing it by pausing the loop until the clock caught up.
- **The day selector gated navigation on `/api/days`** — the days with recorded runs — rather than on the calendar. On a fresh database that list is just `[today]`, so "prev" stepped back exactly one day and then greyed out. This contradicted the data model it was built on: a day's track is a pure function of its date, so every date is a real road whether or not anyone has driven it.

All three lived in `client/`, the one layer this project admits was never under test, and the suite stayed green through every one of them — every HTTP spec sends the cookie by hand, and none runs a frame loop. The corrective was not more tests of the same kind but a different *sensor*: a harness driving two real browsers with separate cookie jars. It reproduced in one run what four files of HTTP specs could not reach (A crashed at 68m; B's ghost list gained A with no reload).

I also caught my own test polluting the suite: `spec/realtime.test.ts` posted against `2020-01-01`, the day `spec/ghosts.test.ts` asserts is empty. It passed once on file ordering and failed every rerun against the same database. I now run the suite twice before believing it.

`spec/days-nav.test.ts` is the first test here that imports a client module directly rather than going over HTTP — only possible because the navigation bounds came out of the DOM-bound `#render` into pure `canGoBack`/`canGoForward`. It is a small, deliberate crack in the client test boundary, aimed at exactly the layer that produced all three bugs.

- [`3eb77da`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/3eb77da) —
  real-time over `ws`, `doc/adr/0005-realtime-ghosts.md`, and the auth and NaN fixes
- [`ff045e1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/ff045e1) —
  day selector bounded by the calendar, plus the first client-module spec
- [`19bc2df`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/19bc2df) —
  `reflections/crit-9.md`

## What I'd flag to a marker

- **Deliberately deferred**:
  - ~~Real-time WebSocket broadcasting is deferred to C9.~~ **Done in C9** — the `scoreChanged()` seam was taken up without touching `runs.ts`. Polling survives in `ghosts.ts` as the fallback while the socket is down, so a blocked WebSocket degrades instead of failing.
  - Presence ("who else is driving right now") was considered and refused in ADR 0005, not merely skipped: the ghost is this app's whole vocabulary for other people, and a counter beside it would say the ghosts weren't enough.
  - Audio (engine rumble, collision sounds, synth soundtrack) is deferred to keep the build scoped; Web Audio can be added later without external packages.
  - Mobile touch controls are omitted. The responsive CSS and viewport scale down to mobile screens cleanly, but driving controls currently expect keyboard input (arrow keys / WASD).
- **Client test boundary**: `client/src/` still has no WebGL unit suite, and C9 showed what that costs — all three bugs above lived there, with the spec suite green throughout. Two things changed: `spec/days-nav.test.ts` now tests client logic directly where it is pure, and browser verification moved from eyeballing screenshots to scripted DevTools-protocol harnesses that assert on state (lane solvability, input handling, cross-browser propagation). The honest gap that remains is that those harnesses live outside the repo's `pnpm check`, so they are a tool I run rather than a sensor that runs itself.
- **Rough edges & agent corrections**:
  - The agent initially culled road chunks and ghosts with `scene.remove()` without calling `.dispose()`. While harmless with primitive shared materials, per-chunk shader materials and per-ghost materials caused memory leaks. I had the agent add explicit `.dispose()` calls for geometry, materials, and ghost label DOM nodes upon removal in Phase 4.
  - Typography relies on system fonts and CSS styling rather than external Google Fonts to eliminate external CDN dependencies and avoid Content Security Policy complications.
  - **One commit covers four strands** (real-time, the auth fix, the NaN fix, the speed ceiling) because `net.ts` and `main.ts` each span several, and splitting cleanly would have needed interactive staging under deadline. The message separates them; the history does not.
  - **I overrode a correct objection.** Asked to implement the lane overhaul first, the agent flagged that C9's headline requirement was untouched and that the overhaul moved none of it. I chose the overhaul anyway. It worked out, but the warning was right and I should have weighed it harder than I did.
  - An interactive "Reduce Effects" toggle and `prefers-reduced-motion` queries were added to protect low-spec machines and ensure WCAG compliance (disabling scanlines, flicker, and trauma² camera shake).
