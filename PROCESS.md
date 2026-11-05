# Process overview

## What I built

A synthwave endless runner: drive a seeded three-lane road until you crash, and your best distance becomes a permanent record in that day's archive, seen by others as a translucent ghost. Four weeks added real-time ghosts, a leaderboard, coin-funded trims, trick ramps and invite-only crews — each landing on a decision recorded as an ADR.

## Stack, and what it costs

One 256MB Fly machine and a SQLite volume were fixed; the framework wasn't. I compared Node/Express, Astro, Django+Channels and Phoenix LiveView ([67140e1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/67140e10a4230cd23243f24bc8a9e925be191f92)): Astro has no official WebSocket API, LiveView's DOM diffing fights a WebGL canvas, and Channels has a documented history of memory leaks under live-socket load ([django/channels#1181](https://github.com/django/channels/issues/1181), [#1789](https://github.com/django/channels/issues/1789)) — the one load this machine must carry. Node won because the half that matters, a long-lived socket beside a SQLite file, is plain Node in every option regardless.

It costs three things: hand-written auth, migrations and validation (two of this document's bugs among them); migrations at container boot, since Fly's release machines have no volume; and one process, one file, one machine — nothing here survives a second instance. Right bet for a crew-sized game; I'd reverse it the day it needed two.

## Sources, and my position

The README argues from Robin Sloan's "home-cooked app" and Shirky's "situated software": build for a group who know each other, skip what strangers need. Sloan's app "already knows exactly who's using it"; Shirky's students skipped reputation systems because the community supplied them. I hold that, but this project shows its limit: Sloan's family existed before his app did, while a crew here can't form until strangers find the game. So I kept a global leaderboard ([0009](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0009-leaderboard.md)) and let the road narrow to friends — the small web's ideal is a place; mine is a place you can be invited into.

## Workflow

`plan.md` routed phases mirroring an existing pattern line-for-line (migrations, equip plumbing) to cheaper subagents, keeping visual and architectural calls for a stronger model under close direction ([3694834](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/36948343275a4422cbb559d4c1f90f48a4daacd4)). That plan's first feature, equipping a favourite trick, was built and then thrown away ([ac88764](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/ac8876496e2b6f21ca260b4b0b25170c4671c1f6)): it reversed a deliberate choice for convenience, with no line to the thesis. The routing built it competently; nobody asked whether to.

## The moments that mattered

### Real-browser bugs no spec could reach - [9b681f8...9f280ff](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/9b681f8e9d043ef9164239be9e546cffe8b68905...9f280ff49313711afcb2750ae8858dc784bf43ad)

Headless specs were green, but rendering the game found bugs no test reached: `.modal[hidden]` lost to `display: flex` on specificity, freezing the username modal open; inverted triangle winding culled the road; a mobile double-submit race surfaced only by touching a phone. None touch an HTTP response, so none could be caught headless.

### Three bugs hiding behind each other - [3eb77da](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/3eb77da3b804db9e2460b2248da310527111ad3c) / [ff045e1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/ff045e148a6313d78720da9f65865896a320474f)

The socket itself was nearly free: `scoreChanged()` was a no-op seam from C8. Verification took the week. Two tabs failed to propagate, and my first diagnosis was wrong — shared cookie jar, so one player. Two real browsers uncovered three chained bugs, the first two in `3eb77da`: `httpOnly` meant `hasAccount()` always returned false, so no browser had ever saved a run; fixing that unmasked a negative `requestAnimationFrame` `dt` turning distance into `NaN`. The third, in `ff045e1` minutes later: the day selector gated on recorded runs, not the calendar. All three lived in `client/`, where `pnpm test` stayed green throughout — every HTTP spec sends the cookie by hand, none runs a frame loop. The two-browser check is now a CLAUDE.md rule.

### A decision that argued with itself twice - [a332385...f05a2a2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/a332385ba771b3d4efc829c39fa22e44d92186ce...f05a2a22cf3856d029a9d37c61665759d7201cd7)

This game refused leaderboards from the start. By Crit 10 that cost something real: most of a day's ghosts went unseen, since a run ends at the first barrier. I shipped a compromise — a distance-sorted roster with no rank numbers — to keep the claim alive while fixing the real problem. It didn't survive contact with itself: the record truncating that roster to ten rows had already admitted "everyone reads the top of a distance-sorted list as furthest," the whole ranking minus the printed number. The next record said so directly, printed the ranks, and rewrote the README.

### Reversing "no following," in writing - [38b43d1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/38b43d1935a18a738cb34d172c58849061196d01)

README said "no social layer, no following," but an invite-joined group narrowing your ghosts to crew-only is following in every sense that ruled out. I rewrote the bullet in the same commit: the road narrows to your crew, the leaderboard stays switchable to the whole day. Coins stayed global — a two-person crew taking ranks one and two of its own leaderboard would otherwise mint coins for free.

### An invariant nobody was calling, and two more a review found - [e6302a8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/e6302a857f34ce220b6bac3faf8db04950f2d443) / [a43a285](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/a43a285fa7bac57ea81873f81efb89c7e7a8cd66) / [344b58a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/344b58a083a316f8c3a89b3884d07454febadca0)

`patternIsSolvable` was written to prove the catalogue's one real promise, a route through every pattern always exists, then sat uncalled for thirteen days — checked by hand once at authoring, nothing left to catch a later pattern breaking it. I wired both solvability functions into `spec/`. A later review of the run-end route found two more: coin credit and the best-run upsert as separate writes, now one `db.transaction()`; a malformed cookie crashing the whole `/live` socket for every player. `spec/auth-cookie.test.ts` pins both in the same commit as each fix. CLAUDE.md now says it plainly: a guarantee is the test that runs, not the function that could.

### Six players, a playtest, and the bug the playtest hid for nineteen days - [f364f4f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/f364f4fb355efc25b3ebeaa9b4418de142cac7e3) / [25577c5...2ed2d60](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/25577c5ad3b8d59a206d6b9a682a4793bcec0c8d...2ed2d60fc4e2cad346e95fe6e350c706e9717e44)

`f364f4f`, for the multi-user requirement: I watched `flyctl logs` while six people played at once through two live restarts; coin accounting and scores held (`docs/test/ing/multi-user-test-report.md`). Separately, an earlier crew playtest pushed me to harden the road next morning: moving barriers and oil, then ramps and coins. Each addition's ADR (0012–0015) reasoned carefully about that kind's own `(seed, distance)` purity, and missed the question that matters for a ghost: does turning it on reach backwards into a seed with runs already recorded? It did — writing up the playtest surfaced it, nineteen days on. Seven ghosts on 17 October's road sat on a road that had gained 18 moving barriers and 8 oil spills they never saw, breaking CLAUDE.md's plainest rule. `25577c5...2ed2d60` is the fix: `FEATURE_EPOCH` ([0021](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0021-obstacle-kinds-are-epoch-gated.md)) is the first record landed before the code implementing it, and `spec/past-roads.test.ts` pins the pre-epoch output so a fifth kind can't repeat it.

### The README's own claims, checked - [8d46850](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/8d46850c5f65591de008fa02f4f200baed81414a)

Writing an "enforced vs judged" list for the README meant asking which claims a test actually held. "Lavender means ghost" had none, and writing one failed at once: ghost hues jittered ±0.04, putting some ghosts 0.005 from the buyable violet trim. I narrowed the spread, kept the failing run in the commit message as proof the test bites, and put the rule into CLAUDE.md — which until now held process rules, nothing from the README's own argument.

### What's still unproven

Lessons sat in ADRs for weeks before becoming rules: the C9 bugs were found 11 Oct, the CLAUDE.md rules landed 24 Oct ([9662a18](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/9662a180c8bf59fc33a99ce8a1e75c5fa39a188f)). The two-browser check is a tool I run, not a sensor in `pnpm check`, and several `client/` commits between 24 and 27 October carry no browser-check note. The epoch rule has the same shape solvability once did: written down after one feature broke it, not yet something the next feature is forced to satisfy.
