# 0021. New obstacle kinds are gated to a feature epoch, not retroactive

Status: accepted

## Context

`CLAUDE.md` states a guarantee in the plainest terms it has: "Nothing may
touch `track.ts` output for an existing seed, because every recorded ghost
was driven on that road." ADR 0002 makes the same promise the schema's reason
to exist, and ADR 0006 makes it the reason a past day refuses new runs at
all. Nothing in `spec/` checked it.

0012 (moving barriers, oil), 0013/0014 (ramps) and 0015 (coins) each extended
`chunkFor` to emit a new `Obstacle` kind, and each record reasons carefully
about `(seed, distance)` purity *within* a kind — a moving barrier's `x` is a
pure function of distance, never wall-clock time; oil never sits closer than
`OIL_MIN_LEAD_TO_HAZARD` to the next fatal hazard. None of them asked the one
question that actually protects a recorded ghost: *does turning this kind on
retroactively apply it to a seed that was already playable, with real runs
already recorded against it, before the kind existed?*

It does. `chunkFor("2026-10-17", i)` today returns moving barriers, oil
spills, ramps and coin trails that did not exist when that road was the live
"today" and a crew of seven actually drove it
(`docs/test/17-oct-playtest.md`). Every one of their ghosts now sits on a
road none of them saw: the write-up counts 18 moving barriers and 8 oil
spills in the first 2.4km that their best runs drive straight through,
because each ghost replays only a recorded `(lane, distance)` and never
re-runs collision. The fix made the week-10 road harder, which was the right
call for every day from then on — the bug is that it also reached backwards
into a day that had already closed.

The four features' own commits make this precise. `0459043` (moving
barriers, oil) and the three tuning commits straight after it
(`d496448`, `33739ca`, `f39407e`) landed within UTC `2026-10-17`; `2646f09`
(ramps) and `baabd9d` (coins) landed within UTC `2026-10-18`. By the time
any of them shipped, `2026-10-17` was no longer "today" in the code's own
sense — ADR 0006 had already closed it to new writes — but `track.ts` has no
concept of "closed" at all. It is a pure function of `(seed, distance)` with
no notion of *when the function itself last changed*, so a seed string that
already had recorded history gets regenerated under whatever generator
happens to be running today.

## Decision

**`track.ts` gains `FEATURE_EPOCH = "2026-10-18"`, the first UTC date that
did not exist yet when `0459043` shipped — the first day the richer
generator could fairly apply to, because nobody could have a recorded ghost
on it before the code did.** `chunkFor` still generates static barriers
(`kind: "barrier"`) for every seed exactly as it always has; the
moving-barrier, oil, ramp and coin blocks only run when
`seed >= FEATURE_EPOCH`. For any seed before the epoch, `chunkFor` now
produces exactly what the generator produced the day that seed's road was
actually live — static barriers only, laid out by `rowsThrough`, untouched
by anything that shipped after it.

This is checkable, not just argued: `rowsThrough`, `playlistFor` and
`gateSpacingAt` — the whole static-barrier path — have not changed a single
line since before `0459043`, so gating the four new blocks rather than
rewriting any of them is sufficient by construction, and `spec/past-roads.
test.ts` pins the exact obstacle list `chunkFor` produces for a pre-epoch
seed against the output of the generator as it stood at `edd63a6`, the
commit immediately before `0459043`.

One epoch, not one per feature. Ramps and coins shipped a few hours after
moving barriers and oil, inside the same UTC day on which the first regime
had already landed. No evidence exists of anyone playing `2026-10-18`
between those two points — the earliest multi-user activity on record,
`f364f4f`, is UTC `2026-10-19` — so splitting the epoch by feature would add
a constant for a seam no known ghost sits on either side of. A single date
is the simplest rule a future obstacle kind can also point at, and
`CLAUDE.md` is updated to say so.

## Alternatives considered and ruled out

**Leave the generator as it is and weaken the promise in `README.md` and
`CLAUDE.md` instead.** Cheaper, and the honest move if the promise really
couldn't be kept. But it was never the mechanism that couldn't keep it —
it's one afternoon's commits that forgot to ask the question — so weakening
the claim would be retreating from the thesis for convenience, the exact
move ADR 0020 refused to let a different feature get away with.

**Invalidate or delete the seven `2026-10-17` ghosts.** Rejected outright.
They are the one piece of real evidence this project has that the core
mechanic reads as intended ("ghosts were a good way of seeing each other's
scores" — the playtest's own write-up); throwing them away to make the bug
disappear destroys the thing ADR 0006 exists to protect instead of fixing
the generator that endangered it.

**Store each day's actual obstacle set in the database at generation time,
rather than deriving it purely from `(seed, distance)` plus the code that
happens to be running.** The more correct long-term design — a future
geometry change could never again reach backwards, with no epoch constant to
remember to add — but it is a real schema and pipeline change this late in
the project, trading a one-line gate for a new table and a migration path
for data that does not yet exist. Worth a follow-up record if a second
obstacle kind ever ships; not justified to fix the one kind of mistake made
so far.

## Consequences

- `2026-10-17` and every seed before it regenerate exactly as the game
  looked before `0459043` — static barriers only — which is what every
  ghost currently recorded on those days actually drove. `2026-10-18` onward
  keeps the full generator, including every day a real player has driven
  since the richer road shipped.
- `spec/past-roads.test.ts` makes this a running check, not a comment: it
  pins the literal obstacle list for a pre-epoch seed and asserts a
  epoch-or-later seed carries every new kind. A future change to the static
  path that drifts from the pinned list fails loudly, the same way
  `spec/track-patterns.test.ts` turned `patternIsSolvable` from a function
  that could be called into one that is.
- **The epoch is a date someone has to remember to move.** A fifth obstacle
  kind added without its own gate would make the same mistake this record
  fixes, just once more. `CLAUDE.md`'s "never change yesterday" rule now
  names this record and the pattern to follow, so the next feature has
  somewhere to look before it ships.
- No schema, route or ghost-recording change. This is confined to
  `client/src/track.ts`'s generator, the same scope ADR 0012 and ADR 0013
  stayed inside.
