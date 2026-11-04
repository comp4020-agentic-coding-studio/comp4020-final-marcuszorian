# Harness for nightly build

`README.md` is the argument: a ghost is a trace of someone you drive past, a
day is a place, and the road is for a crew, not a crowd. The rules below hold
work to that argument; `spec/` is where the checkable parts of it run. If a
change would make a README sentence false, change the README in the same
commit or don't make the change.

## What the app must never do

- **Never show another player in motion.** A ghost arrives finished: one
  position, after the run ends. No live cars, no positions streamed mid-run,
  no "N driving now". ADR 0005 rejected both: live cars turn a place into a
  race, and a counter says the ghosts weren't enough. Reversing it takes a superseding ADR, not a feature request.
- **Never let a ghost be mistaken for a car.** Lavender means ghost, red means
  obstacle, and nothing for sale may wear either or sit close to them
  (`spec/ghost-colour.test.ts`, ADR 0003). A new trim, a ghost tint or a
  palette change runs that spec before anything else.
- **Never change yesterday.** A day's road is a pure function of its date
  (ADR 0002) and a past day refuses new runs (ADR 0006). Nothing may touch
  `track.ts` output for an existing seed, because every recorded ghost was
  driven on that road.
- **Never widen what a crew member sees beyond their crew** on the road,
  live or on reload (`spec/crews.test.ts`, `spec/realtime.test.ts`).

## Before adding a feature

Ask the README's question first: does it change what a crash *means*, or only
your score? If only your score, say so in its ADR and argue only that it
breaks none of the guarantees above, as ADRs 0013–0017 do. Don't let it into
the README's definition of good. Prefer saying no: README's "What I chose not
to build" is part of the design.

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
