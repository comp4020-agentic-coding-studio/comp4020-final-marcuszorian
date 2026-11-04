# Process overview

## What I built

A synthwave endless runner: drive a seeded three-lane road until you crash, and your best distance becomes a permanent record in that day's archive, seen by others as a translucent ghost. Four weeks added real-time ghosts, a leaderboard, coin-funded trims, trick ramps and invite-only crews, each landing on a decision recorded as an ADR.

## Stack, and what it costs

One 256MB Fly machine and a SQLite volume were fixed; the framework wasn't. I compared Node/Express, Astro, Django+Channels and Phoenix LiveView ([67140e1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/67140e10a4230cd23243f24bc8a9e925be191f92)). Astro has no official WebSocket API, LiveView's DOM diffing fights a WebGL canvas, and Channels has documented memory leaks under live sockets — the one load this machine must carry. Node won because the half that matters, a long-lived socket beside a SQLite file, is plain Node in every option anyway.

It costs three things. No batteries: auth, migrations and validation are hand-written, and two bugs below came from exactly that code. Migrations run at container boot, because Fly's release machines have no volume. And one process with one file means one machine: nothing here survives a second instance. For a game sized for a crew that's the right bet; I'd reverse it the day it needed two machines. Scores are keyed `(user_id, track_seed)`, so a day is a permanent record.

## Sources, and my position

The README argues from Robin Sloan's "home-cooked app" and Shirky's "situated software": build for a group who know each other, and skip what strangers need. I hold that, but this project shows its limit. A crew can't exist until strangers find the game, so I kept a global leaderboard ([0009](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/blob/main/doc/adr/0009-leaderboard.md)) and let the road narrow to friends. The small web's ideal is a place; mine is a place you can be invited into.

## Workflow

`plan.md` routed phases that mirror an existing pattern line-for-line (migrations, equip plumbing) to cheaper subagents, and kept visual and architectural calls for a stronger model under close direction ([3694834](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/36948343275a4422cbb559d4c1f90f48a4daacd4)). Cheap agents copy a reference well; they don't judge whether it should exist. That same plan's first feature, equipping a favourite trick, was built and then thrown away ([ac88764](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/ac8876496e2b6f21ca260b4b0b25170c4671c1f6)): it reversed a deliberate choice for convenience and had no line to the thesis. The routing built it competently; nobody in the routing asked whether to.

## The moments that mattered

### Real-browser bugs no spec could reach - [9f280ff...9b681f8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/9f280ff49313711afcb2750ae8858dc784bf43ad...9b681f8e9d043ef9164239be9e546cffe8b68905)

Headless specs were green, but rendering the game found bugs no test reached: `.modal[hidden]` lost to `display: flex` on specificity, so the username modal stayed frozen open; inverted triangle winding culled the road; and a mobile double-submit race surfaced only from touching it on a phone. None touch an HTTP response, so none could be caught headless.

### Three bugs hiding behind each other - [3eb77da](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/3eb77da3b804db9e2460b2248da310527111ad3c)

The socket was nearly free: `scoreChanged()` was a no-op seam from C8. Verification took the week. Two tabs failed to propagate, and my first diagnosis was wrong: they shared a cookie jar, so were one player. Two separate browsers uncovered three chained bugs: `httpOnly` meant `hasAccount()` was always false, so no real browser had ever saved a run; fixing that unmasked a negative `requestAnimationFrame` `dt` turning distance into `NaN`; and the day selector gated on recorded runs, not the calendar. All three lived in `client/`, and `pnpm test` stayed green throughout, because HTTP specs send the cookie by hand and none runs a frame loop. The two-browser check became a CLAUDE.md rule.

### A decision that argued with itself twice - [a332385...f05a2a2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/a332385ba771b3d4efc829c39fa22e44d92186ce...f05a2a22cf3856d029a9d37c61665759d7201cd7)

This game refused leaderboards from the start. By Crit 10 that cost something real: most of a day's ghosts went unseen, since a run ends at the first barrier. I shipped a compromise, a distance-sorted roster with no rank numbers, to keep the claim alive while fixing the real problem. It didn't survive contact with itself: the record truncating that roster to ten rows had admitted that "everyone reads the top of a distance-sorted list as furthest" — the whole ranking, minus the printed number. The next record said so directly, printed the ranks, and rewrote the README rather than leave the sentence standing.

### Reversing "no following," in writing - [38b43d1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/38b43d1935a18a738cb34d172c58849061196d01)

README said "no social layer, no following," but an invite-joined group narrowing your ghosts to crew-only is following in every sense that sentence ruled out. I rewrote the bullet in the same commit and documented the tension: the road narrows to your crew, but the leaderboard stays switchable to the whole day. Coins stayed global: a two-person crew taking ranks one and two of its leaderboard would mint coins for free.

### An invariant nobody was calling - [e6302a8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/e6302a857f34ce220b6bac3faf8db04950f2d443)

`patternIsSolvable` was written to prove the catalogue's one real promise, a route through every pattern always exists, then sat uncalled for three weeks. The catalogue had only been checked by hand once, nothing left to catch a pattern later breaking the guarantee. I wired both solvability functions into `spec/` and added the lesson to CLAUDE.md: a guarantee is the test that runs, not the function that could.

### Two bugs fixed the same afternoon, after shipping - [a43a285](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/a43a285fa7bac57ea81873f81efb89c7e7a8cd66) / [344b58a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/344b58a083a316f8c3a89b3884d07454febadca0)

A review of the run-end route found coin credit and the best-run upsert as separate writes (now one `db.transaction()`), and a malformed cookie crashing the whole `/live` socket for every player. I wrote `spec/auth-cookie.test.ts` to pin both paths before fixing either.

### Six players against the real deploy - [f364f4f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/f364f4fb355efc25b3ebeaa9b4418de142cac7e3)

For the multi-user requirement I watched `flyctl logs` while six people played at once, through two live restarts. Coin accounting and high scores held with no cross-user mixups; evidence and gaps are in `docs/test/ing/multi-user-test-report.md`.

### The README's own claims, checked - [8d46850](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/8d46850c5f65591de008fa02f4f200baed81414a)

Writing an "enforced vs judged" list for the README meant asking which of its claims a test actually held. "Lavender means ghost" had none, and writing one failed at once: ghost hues jittered ±0.04, putting some ghosts 0.005 from the buyable violet trim. I narrowed the spread, kept the failing run in the commit message as proof the test bites, and wrote the rule into CLAUDE.md, which until now held process rules but nothing from the README's argument.

### What's still unproven

Lessons sat in ADRs for weeks before becoming rules: the C9 bugs were found 11 Oct, the CLAUDE.md rules landed 24 Oct ([9662a18](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/9662a180c8bf59fc33a99ce8a1e75c5fa39a188f)). ADR-before-code ordering is stated intent, not checked by a script. The two-browser check is a tool I run, not a sensor in `pnpm check`, and five `client/` commits from 24–27 Oct carry no browser-check note. Audio and touch-first controls stay deferred.
