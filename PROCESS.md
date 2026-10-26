# Process overview

## What I built

A synthwave endless-runner: drive a seeded, three-lane road until you crash, and your best distance for that day's seed becomes a permanent record in that day's archive. Other players who drove the same day appear afterwards as translucent ghost cars, a trace of a finished run, not a live opponent. Four weeks added real-time ghost broadcast, a leaderboard, coin-funded skins and trick ramps, and invite-only crews — each landing on a decision recorded as an ADR, not a quiet change.

## Decisions, before code

The brief asked for a multi-user app on one 256MB Fly VM with a SQLite volume. Rather than accept whatever the agent reached for first, I compared Node/Express, Astro, Django+Channels and Phoenix LiveView: Astro has no official WebSocket API, Phoenix's server-rendered diffing fights a client-side WebGL loop, and Django Channels has documented async-sync ORM issues at this size. Node won ([67140e1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/67140e10a4230cd23243f24bc8a9e925be191f92)); the same record keyed `best_runs` on `(user_id, track_seed)`, making a day permanent, not a rolling high score.

The workflow choice was just as deliberate: `plan.md` routes phases mirroring an existing pattern line-for-line (migrations, equip plumbing, `pnpm check`) to cheaper subagents, and keeps phases needing visual or architectural judgement for a stronger one directing closely ([3694834](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/36948343275a4422cbb559d4c1f90f48a4daacd4)) — cheap agents copy a reference well; they don't invent one.

## The moments that mattered

### Real-browser bugs no spec could reach - [9f280ff...9b681f8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/9f280ff49313711afcb2750ae8858dc784bf43ad...9b681f8e9d043ef9164239be9e546cffe8b68905)

Backend first: routes, WAL-mode SQLite, migrations run at container boot since Fly's `release_command` machines have no volume attached. Headless specs were green, but rendering the game in a browser found bugs no test reached: `.modal[hidden]` lost to `display: flex` on specificity, so the username modal stayed visibly frozen open though `hidden` toggled correctly in the DOM; inverted triangle winding on the road mesh pointed front faces away from the camera, culling the road; and a mobile double-submit race surfaced only from touching the thing on a phone — none touch an HTTP response, so none could have been caught headless.

### Three bugs hiding behind each other - [3eb77da](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/3eb77da3b804db9e2460b2248da310527111ad3c)

C9 asked for real-time ghosts, and the socket cost almost nothing: `scoreChanged()` was wired in C8 as a no-op seam, so lighting it up didn't touch `runs.ts`. Verification consumed the week instead. Two tabs failed to show propagation; my first diagnosis was wrong — both shared one cookie jar, so they were the same player. Two genuinely separate browsers uncovered three chained bugs: `setAuthCookie` sets `httpOnly`, so `document.cookie` could never hold the token, so `hasAccount()` always returned false and no real browser had saved a run, every ghost instead written by the test suite; fixing that unmasked `requestAnimationFrame` reporting a timestamp earlier than `lastTime`, turning distance into `NaN`; and behind both, a day selector gating navigation on recorded runs, not the calendar. All three lived in `client/`, with no automated test, and `pnpm test` stayed green throughout: HTTP specs send the cookie by hand, none run a frame loop. The fix: a harness driving two real browsers with separate cookie jars, now a CLAUDE.md rule.

### A decision that argued with itself twice - [a332385...f05a2a2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/a332385ba771b3d4efc829c39fa22e44d92186ce...f05a2a22cf3856d029a9d37c61665759d7201cd7)

This game refused leaderboards from the start: a ghost is a trace you drive past, not a rank you check. By Crit 10 that refusal was costing something real: most of a day's ghosts never seen, since a run ends at the first barrier. I shipped a compromise, a distance-sorted roster with no rank numbers, to keep the claim alive while fixing the real problem. It didn't survive contact with itself: the record truncating that roster to ten rows had admitted that "everyone reads the top of a distance-sorted list as furthest" — the whole ranking, minus the printed number. The next record said so directly, printed the ranks, and rewrote the README rather than leave the sentence standing.

### Reversing "no following," in writing - [38b43d1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/38b43d1935a18a738cb34d172c58849061196d01)

Crews ask for the same honesty. README said "no social layer, no following," but an invite-joined group narrowing your ghosts to crew-only is following in every sense that sentence ruled out. I rewrote the bullet in the same commit and documented the tension: the road narrows to your crew, but the leaderboard stays switchable to the whole day. Coins stayed global: a two-person crew taking ranks one and two of its leaderboard would mint coins for free.

### An invariant nobody was calling - [e6302a8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/e6302a857f34ce220b6bac3faf8db04950f2d443)

`patternIsSolvable` was written to prove the catalogue's one real promise, a route through every pattern always exists, then sat uncalled for three weeks. The catalogue had only been checked by hand once, nothing left to catch a pattern later breaking the guarantee. I wrote the missing test, wired both solvability functions into `spec/`, and added the lesson to CLAUDE.md: a guarantee is the test that runs, not the function that could.

### Two bugs fixed the same afternoon, after shipping - [a43a285](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/a43a285fa7bac57ea81873f81efb89c7e7a8cd66) / [344b58a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/344b58a083a316f8c3a89b3884d07454febadca0)

A pre-tranche review of the run-end route found two bugs: coin-credit and the best-run upsert were separate writes, so a failure between them could credit coins for a run never recorded (fixed with one `db.transaction()`); and a malformed cookie threw uncaught inside `tokenFromCookieHeader` — 500ing over HTTP, but crashing the whole `/live` socket for every player. I wrote `spec/auth-cookie.test.ts` to pin the HTTP and WS paths before fixing either.

### Six players against the real deploy - [f364f4f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/f364f4fb355efc25b3ebeaa9b4418de142cac7e3)

Everything above was verified locally or against a single browser pair; for the multi-user requirement I pulled `flyctl logs` while six people played at once, including two live restarts mid-session. Coin accounting and high-score chains held with no cross-user mixups, and the sync fallback restored state after both restarts. Full evidence and what wasn't covered are in `docs/test/ing/multi-user-test-report.md`.

### What's still unproven

Four weeks of lessons sat in ADRs before any became a rule the agent is held to: CLAUDE.md carried only the day-one ADR convention until this rewrite added the two rules above. `client/src/` still has no WebGL unit suite; the two-browser harness that found C9's bugs lives outside `pnpm check` as a tool I run, not a sensor that runs itself. Two gaps follow, named here rather than left for a marker. The "ADR before implementation" ordering this rewrite requires is a stated intent, not anything a script checks — nothing stops a commit reversing it again. And the browser-check rule ([9662a18](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/9662a180c8bf59fc33a99ce8a1e75c5fa39a188f)) predates five `client/`-touching commits from 24–27 Oct (font sizes, capitalisation, leaderboard width, a tutorial line) carrying no "checked in browser" note despite already being live. Audio, touch controls, and a presence indicator stay deferred, the last refused twice on the grounds the ghosts exist for.
