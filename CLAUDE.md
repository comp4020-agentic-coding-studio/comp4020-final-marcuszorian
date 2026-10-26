# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## Decisions

Decisions live in `doc/adr/`, one numbered file each. Read them before changing
the stack, storage or data model. To change one, write a record superseding
it: an accepted record is never edited.

Write the superseding record *before* changing the code, not after. Every
reversal so far (`0006`, `0009`, `0011`) was drafted as part of the same
sitting as the code that followed from it — not a diff that got rationalized
into a record afterward — but the commits don't actually separate "record"
from "diff" in time, so don't claim they prove an ordering they don't. From
here on, land the ADR in its own commit before the commit that implements it,
so the ordering is checkable in history, not just asserted in prose. A record
written after the fact is a changelog, not a decision.

## Client code ships with a browser check, not just a green suite

`client/src/` runs with no automated test of its own kind: the WebSocket feed,
the frame loop, cookie-based auth. C9 shipped three real bugs there
(`httpOnly` silently defeating `hasAccount()`, a negative `dt` from
`requestAnimationFrame` turning distance to `NaN`, a day selector gated on
recorded runs instead of the calendar) and `pnpm test` stayed green through
all three, because every HTTP spec sends the cookie by hand and none runs a
frame loop. Before calling a change to `client/` done, drive it in a real
browser (or two real browser windows with separate cookie jars, the manual
check `spec/realtime.test.ts`'s API-level test is modeled on — no committed
script automates this yet) and say in the commit what you checked, not just
that tests pass.

## A guarantee is the test that runs, not the function that could

`patternIsSolvable`/`movingPatternIsSolvable` were written to enforce ADR
0004's promise that every track is beatable, then sat uncalled from anywhere
for the entire C10 build, the catalogue checked by hand once at authoring time
and never again. Writing the check is half the job. When a decision record
names an invariant, wire the function that proves it into `spec/` in the same
change, or it is prose, not a guarantee.
