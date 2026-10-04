# Process overview

<!-- SKELETON: commit citations and a factual timeline are filled in below.
     The actual account — what you decided, where you corrected or
     overrode the agent, what you'd do differently — is marked [[ ]] and is
     yours to write. Delete this comment and every [[ ]] marker before
     submitting; pnpm check:evidence only checks that the TEMPLATE comment
     is gone and that every cited commit resolves, not that you've actually
     replaced the markers, so that part is on you to catch. -->

How you got from the brief to the harness, agentic workflow and stack behind
this app. The
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/#what-you-submit)
says what it covers and how long it runs.

## Decisions, before code

[[Why Node/Express/better-sqlite3/Three.js over the alternatives, and why
best_runs is keyed by (user, day) — or just point at the ADRs and say what
your own role was in reaching them.]]

- [`67140e1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/67140e1) —
  `doc/adr/0001-stack.md`, `doc/adr/0002-daily-seeded-archive.md`
- [`357f8d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/357f8d1) —
  decision-record convention and the week's plan

## C8: server, game, first deploy

[[What you directed vs. what the agent proposed; anything you had to correct
— the two real bugs browser smoke-testing caught (`.modal[hidden]` losing
to the UA stylesheet, the road's back-face culling) are a concrete example
if you want one.]]

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

[[Your own framing matters most here: why this theme rather than generic
polish, and where you pushed back on or redirected the agent's first pass —
e.g. the plan originally over-scoped before you cut it down, or a palette/
effect choice you overruled. `plan.md` and `doc/adr/0003-visual-direction.md`
carry the technical argument; this section is your account of directing it,
not a restatement of theirs.]]

- [`5935410`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/commit/5935410) —
  `plan.md`: the visual-direction plan
- [`216b3b5...f98b15d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-marcuszorian/compare/216b3b5...f98b15d) —
  the four phases (palette/sky/bloom; grid/sun/mountains; HUD/readme theming;
  camera feel/ghosts/crash feel) plus `doc/adr/0003-visual-direction.md`

## What I'd flag to a marker

[[Anything deliberately deferred, anything you know is rough, anything the
agent got wrong that you let stand and why.]]
